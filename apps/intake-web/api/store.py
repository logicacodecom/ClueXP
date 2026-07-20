"""Ticket persistence.

Selected at import time from the environment:
- DATABASE_URL set  -> Supabase Postgres (`jobs.detail` JSONB plus queryable
  dispatch columns, with events linked by `job_id`). Use the Supabase
  *transaction pooler* URL (port 6543) on Vercel serverless; prepared statements
  are disabled so the pooler is happy.
- DATABASE_URL unset -> in-memory store, for local development without a DB.

The Ticket Pydantic model stays the single source of truth: we persist
`Ticket.model_dump(mode="json")` into `jobs.detail` and rehydrate with
`Ticket.model_validate`, while promoting the fields dispatch needs to query.
"""

from __future__ import annotations

import json
import os
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from api.auth import hash_password, verify_password
from api.dispatch import (
    CARD_PAYMENT_METHODS,
    STATUS_ARRIVED,
    STATUS_ASSIGNED,
    STATUS_CANCELLED,
    STATUS_COMPLETED_AUTO_CLOSED,
    STATUS_COMPLETED_CONFIRMED,
    STATUS_COMPLETED_PENDING,
    STATUS_DISPUTED,
    STATUS_EN_ROUTE,
    STATUS_IN_PROGRESS,
    STATUS_PENDING_DISPATCH,
    STATUS_TIMESTAMP_COLUMN,
    HISTORY_STATUSES,
    TECHNICIAN_HISTORY_STATUSES,
    can_customer_cancel,
    may_show_live_tracking,
    customer_actions,
    eta_range_from_km,
    haversine_km,
    is_terminal,
    location_is_fresh,
    normalize_policy,
    resolve_dispatch_state,
)
from api import config
from api.closeout_catalog import default_closeout_item_types
from api.service_catalog import default_service_catalog, normalize_skill_code
from api import settings as runtime_settings
from api.schema import Ticket

DATABASE_URL = os.environ.get("DATABASE_URL")

# Demo/seed login password. Intentionally simple for the demo environment; override
# via env. The JWT signing secret (AUTH_SECRET) is separate and must still be strong.
DEMO_PASSWORD = os.environ.get("DEMO_SEED_PASSWORD", "123456")


def _default_agreement(organization_id: str, technician_id: str) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    return {
        "id": None,
        "organization_id": str(organization_id),
        "technician_id": str(technician_id),
        "status": "draft",
        "effective_from": None,
        "effective_until": None,
        "default_labor_cut_basis_points": 5000,
        "tip_policy": "tech_keeps",
        "tip_cut_basis_points": 10000,
        "card_fee_policy": "company_pays",
        "minimum_payout_cents": 0,
        "flat_job_bonus_cents": 0,
        "service_area_counties": [],
        "service_area_zipcodes": [],
        "service_hours": {},
        "rules": {"skill_cuts": {}, "category_cuts": {}, "targets": []},
        "created_at": now,
        "updated_at": now,
        "updated_by": None,
    }


def _active_status_started_at(status: str | None, timestamps: dict[str, str | None]) -> str | None:
    """Resolve the timestamp for the job's current lifecycle status, if known."""
    column = STATUS_TIMESTAMP_COLUMN.get(status or "")
    if not column:
        return None
    return timestamps.get(column)


def _agreement_cut_basis_points(agreement: dict | None, skill_code: str | None) -> int:
    if not agreement:
        return 0
    rules = agreement.get("rules") or {}
    skill_cuts = rules.get("skill_cuts") or {}
    category_cuts = rules.get("category_cuts") or {}
    if skill_code and skill_code in skill_cuts:
        return int(skill_cuts[skill_code])
    category = skill_code.split(".", 1)[0] if skill_code and "." in skill_code else None
    if category and category in category_cuts:
        return int(category_cuts[category])
    return int(agreement.get("default_labor_cut_basis_points") or 0)


def calculate_settlement(job: dict, agreement: dict | None) -> dict:
    closeout = job.get("closeout") or {}
    lines = closeout.get("line_items") or []
    commissionable_cents = sum(
        int(line.get("line_total_cents") or 0)
        for line in lines
        if line.get("compensation_eligible")
    )
    tech_reimbursement_cents = sum(
        int(line.get("line_total_cents") or 0)
        for line in lines
        if line.get("reimbursement_eligible") and line.get("provided_by") == "technician"
    )
    company_provided_items_cents = sum(
        int(line.get("line_total_cents") or 0)
        for line in lines
        if line.get("reimbursement_eligible") and line.get("provided_by") == "company"
    )
    skill_code = job.get("skill_code")
    if skill_code is None and job.get("access_type"):
        skill_code = normalize_skill_code(str(job.get("access_type")))
    cut_bps = _agreement_cut_basis_points(agreement, skill_code)
    labor_cut_cents = int(round(commissionable_cents * cut_bps / 10_000))
    minimum = int((agreement or {}).get("minimum_payout_cents") or 0)
    flat_bonus = int((agreement or {}).get("flat_job_bonus_cents") or 0)
    service_payout_cents = max(labor_cut_cents, minimum if commissionable_cents > 0 else 0) + flat_bonus
    tip_cents = int(closeout.get("tip_cents") or 0)
    tip_policy = (agreement or {}).get("tip_policy") or "company_keeps"
    tip_cut_bps = int((agreement or {}).get("tip_cut_basis_points") or (10000 if tip_policy == "tech_keeps" else 0))
    tech_tip_cents = int(round(tip_cents * tip_cut_bps / 10_000)) if tip_policy in {"tech_keeps", "split"} else 0
    total_cents = int(closeout.get("total_cents") or 0)
    tax_cents = int(closeout.get("tax_cents") or 0)
    card_fee_cents = int(closeout.get("card_fee_cents") or 0)
    tech_payout_cents = service_payout_cents + tech_reimbursement_cents + tech_tip_cents
    company_retained_cents = total_cents - tax_cents - card_fee_cents - tech_payout_cents
    payment_method = closeout.get("method")
    # Card/digital methods are company-processed: the company holds the funds and
    # owes the tech their cut (positive). Cash/P2P methods (venmo, zelle, ...) are
    # collected by the technician directly, so the balance flips: the tech is
    # holding the full total and owes the company everything above their payout.
    collected_by_technician = bool(payment_method) and payment_method not in CARD_PAYMENT_METHODS
    settlement_value_cents = (
        -(total_cents - tech_payout_cents) if collected_by_technician else tech_payout_cents
    )
    return {
        "job_id": job.get("id") or closeout.get("job_id"),
        "technician_id": job.get("fulfillment_technician_id"),
        "technician_display_name": job.get("technician_display_name"),
        "status": job.get("status"),
        "finished_at": job.get("finished_at"),
        "skill_code": skill_code,
        "agreement_id": (agreement or {}).get("id"),
        "agreement_status": (agreement or {}).get("status") or "missing",
        "cut_basis_points": cut_bps,
        "currency": closeout.get("currency", "USD"),
        "customer_total_cents": total_cents,
        "tax_cents": tax_cents,
        "card_fee_cents": card_fee_cents,
        "tip_cents": tip_cents,
        "commissionable_cents": commissionable_cents,
        "company_provided_items_cents": company_provided_items_cents,
        "tech_reimbursement_cents": tech_reimbursement_cents,
        "tech_service_payout_cents": service_payout_cents,
        "tech_tip_cents": tech_tip_cents,
        "tech_payout_cents": tech_payout_cents,
        "company_retained_cents": company_retained_cents,
        "payment_method": payment_method,
        "settlement_value_cents": settlement_value_cents,
        "review": job.get("review"),
        "payments": job.get("payments"),
        "closeout": closeout,
    }


def _settlement_period_totals(rows: list[dict], adjustments: list[dict] | None = None) -> dict:
    adjustments = adjustments or []
    total_adjustments = sum(int(item.get("amount_cents") or 0) for item in adjustments)
    return {
        "job_count": len(rows),
        "customer_total_cents": sum(int(row.get("customer_total_cents") or 0) for row in rows),
        "tax_cents": sum(int(row.get("tax_cents") or 0) for row in rows),
        "card_fee_cents": sum(int(row.get("card_fee_cents") or 0) for row in rows),
        "tech_payout_cents": sum(int(row.get("tech_payout_cents") or 0) for row in rows),
        "company_retained_cents": sum(int(row.get("company_retained_cents") or 0) for row in rows),
        "adjustment_cents": total_adjustments,
        "final_tech_payout_cents": sum(int(row.get("tech_payout_cents") or 0) for row in rows) + total_adjustments,
    }


def aggregate_settlements_by_technician(rows: list[dict]) -> list[dict]:
    """Group settlement rows into one summary per technician for the master
    financial report. Pure function over rows from list_provider_settlements."""
    groups: dict[str, dict] = {}
    for row in rows:
        key = str(row.get("technician_id"))
        group = groups.setdefault(key, {
            "technician_id": key,
            "technician_display_name": None,
            "affiliation_ended": bool(row.get("affiliation_ended")),
            "affiliation_ended_at": row.get("affiliation_ended_at"),
            "job_count": 0,
            "customer_total_cents": 0,
            "tech_payout_cents": 0,
            "company_retained_cents": 0,
            "settlement_value_cents": 0,
            "company_owes_tech_cents": 0,
            "tech_owes_company_cents": 0,
            "review_count": 0,
            "_rating_sum": 0,
            "agreement_statuses": set(),
        })
        group["technician_display_name"] = group["technician_display_name"] or row.get("technician_display_name")
        group["job_count"] += 1
        group["customer_total_cents"] += int(row.get("customer_total_cents") or 0)
        group["tech_payout_cents"] += int(row.get("tech_payout_cents") or 0)
        group["company_retained_cents"] += int(row.get("company_retained_cents") or 0)
        value = int(row.get("settlement_value_cents") or 0)
        group["settlement_value_cents"] += value
        if value >= 0:
            group["company_owes_tech_cents"] += value
        else:
            group["tech_owes_company_cents"] += -value
        rating = (row.get("review") or {}).get("rating")
        if rating is not None:
            group["review_count"] += 1
            group["_rating_sum"] += rating
        group["agreement_statuses"].add(row.get("agreement_status") or "missing")
    out = []
    for group in groups.values():
        rating_sum = group.pop("_rating_sum")
        group["average_rating"] = round(rating_sum / group["review_count"], 1) if group["review_count"] else None
        group["average_job_cents"] = int(round(group["customer_total_cents"] / group["job_count"])) if group["job_count"] else 0
        group["agreement_statuses"] = sorted(group["agreement_statuses"])
        out.append(group)
    out.sort(key=lambda item: item["customer_total_cents"], reverse=True)
    return out


def compute_settlement_payment_balance(settlement_group: dict | None, payments: list[dict]) -> dict:
    """Outstanding balance for one org<->technician pair.

    settlement_group is the ALL-TIME by-technician aggregate (or None when the
    tech has no settled jobs); payments are that pair's ledger entries. Only
    confirmed payments reduce the balance -- pending is surfaced separately and
    rejected/voided never count. Two one-sided buckets are clamped at zero so an
    overpayment on one side never manufactures debt on the other."""
    company_owes = int((settlement_group or {}).get("company_owes_tech_cents") or 0)
    tech_owes = int((settlement_group or {}).get("tech_owes_company_cents") or 0)
    confirmed_c2t = sum(
        int(p.get("amount_cents") or 0) for p in payments
        if p.get("status") == "confirmed" and p.get("direction") == "company_to_technician"
    )
    confirmed_t2c = sum(
        int(p.get("amount_cents") or 0) for p in payments
        if p.get("status") == "confirmed" and p.get("direction") == "technician_to_company"
    )
    pending_t2c = sum(
        int(p.get("amount_cents") or 0) for p in payments
        if p.get("status") == "pending" and p.get("direction") == "technician_to_company"
    )
    outstanding_c2t = max(0, company_owes - confirmed_c2t)
    outstanding_t2c = max(0, tech_owes - confirmed_t2c)
    return {
        "confirmed_company_to_tech_cents": confirmed_c2t,
        "confirmed_tech_to_company_cents": confirmed_t2c,
        "pending_tech_to_company_cents": pending_t2c,
        "outstanding_company_to_tech_cents": outstanding_c2t,
        "outstanding_tech_to_company_cents": outstanding_t2c,
        "net_outstanding_cents": outstanding_c2t - outstanding_t2c,
    }


async def _skill_label_map(store) -> dict[str, str]:
    labels: dict[str, str] = {}
    for category in await store.list_service_catalog():
        for skill in category.get("skills", []) or []:
            labels[skill["code"]] = skill["label"]
    return labels


async def _item_type_label_map(store) -> dict[str, str]:
    return {item["code"]: item["label"] for item in await store.list_closeout_item_types()}


def _humanize_code(code: str) -> str:
    return code.rsplit(".", 1)[-1].replace("_", " ").title()


def _month_key(iso: str | None) -> str | None:
    return str(iso)[:7] if iso else None


def _month_range(period_start: str | None, period_end: str | None) -> list[str]:
    """Inclusive list of 'YYYY-MM' strings. An explicit range returns every month
    it intersects (including zero-value months); no range returns the trailing
    six calendar months ending this month."""
    def add_month(year: int, month: int, delta: int) -> tuple[int, int]:
        idx = year * 12 + (month - 1) + delta
        y, m0 = divmod(idx, 12)
        return y, m0 + 1

    if period_start or period_end:
        start_y, start_m = (int(x) for x in (period_start or period_end)[:7].split("-"))
        end_y, end_m = (int(x) for x in (period_end or period_start)[:7].split("-"))
    else:
        today = datetime.now(timezone.utc).date()
        end_y, end_m = today.year, today.month
        start_y, start_m = add_month(end_y, end_m, -5)

    months = []
    y, m = start_y, start_m
    while (y, m) <= (end_y, end_m):
        months.append(f"{y:04d}-{m:02d}")
        y, m = add_month(y, m, 1)
    return months


def build_financial_overview(
    all_time_rows: list[dict],
    period_rows: list[dict],
    payments: list[dict],
    periods: list[dict],
    *,
    period_start: str | None,
    period_end: str | None,
    skill_labels: dict[str, str],
    item_labels: dict[str, str],
) -> dict:
    """Pure aggregation backing GET /provider/financial-overview.

    Callers are responsible for supplying the COMPLETE org-scoped dataset --
    this function never truncates, samples, or caps; every row passed in is
    counted. `all_time_rows` drives balances/attention/collection (never
    period-filtered, per the all-time balance rule); `period_rows` drives
    period_metrics/trend/insights (already filtered by the caller via
    `_settlement_row_in_period`, so undated rows are included exactly as that
    existing convention dictates)."""
    undated_rows = [r for r in period_rows if not r.get("finished_at")]
    dated_rows = [r for r in period_rows if r.get("finished_at")]

    job_count = len(period_rows)
    customer_collected = sum(int(r.get("customer_total_cents") or 0) for r in period_rows)
    tech_payout = sum(int(r.get("tech_payout_cents") or 0) for r in period_rows)
    tech_reimbursement = sum(int(r.get("tech_reimbursement_cents") or 0) for r in period_rows)
    company_retained = sum(int(r.get("company_retained_cents") or 0) for r in period_rows)

    # --- monthly trend: dated rows only ---
    month_keys = _month_range(period_start, period_end)
    trend_buckets = {
        m: {"customer_collected_cents": 0, "tech_payout_cents": 0, "company_retained_cents": 0}
        for m in month_keys
    }
    for row in dated_rows:
        bucket = trend_buckets.get(_month_key(row.get("finished_at")))
        if bucket is None:
            continue  # outside the requested/derived window
        bucket["customer_collected_cents"] += int(row.get("customer_total_cents") or 0)
        bucket["tech_payout_cents"] += int(row.get("tech_payout_cents") or 0)
        bucket["company_retained_cents"] += int(row.get("company_retained_cents") or 0)
    monthly_trend = [{"month": m, **trend_buckets[m]} for m in month_keys]

    # --- revenue by job type: top 6 + Other ---
    by_skill: dict[str, dict] = {}
    for row in period_rows:
        code = row.get("skill_code") or "unclassified"
        bucket = by_skill.setdefault(code, {
            "job_count": 0, "customer_collected_cents": 0,
            "tech_payout_cents": 0, "company_retained_cents": 0,
        })
        bucket["job_count"] += 1
        bucket["customer_collected_cents"] += int(row.get("customer_total_cents") or 0)
        bucket["tech_payout_cents"] += int(row.get("tech_payout_cents") or 0)
        bucket["company_retained_cents"] += int(row.get("company_retained_cents") or 0)
    ranked_skills = sorted(by_skill.items(), key=lambda kv: kv[1]["customer_collected_cents"], reverse=True)
    job_types = []
    other_skill = {"job_count": 0, "customer_collected_cents": 0, "tech_payout_cents": 0, "company_retained_cents": 0}
    for i, (code, bucket) in enumerate(ranked_skills):
        if i < 6:
            label = "Unclassified" if code == "unclassified" else skill_labels.get(code, _humanize_code(code))
            job_types.append({"skill_code": code, "label": label, **bucket})
        else:
            for k in other_skill:
                other_skill[k] += bucket[k]
    if other_skill["job_count"] > 0:
        job_types.append({"skill_code": "other", "label": "Other", **other_skill})

    # --- customer payment methods (who physically collects, per calculate_settlement's
    # own rule: no recorded method defaults to company-collected, never technician) ---
    by_method: dict[str, dict] = {}
    for row in period_rows:
        raw_method = row.get("payment_method")
        method_key = raw_method or "unknown"
        bucket = by_method.setdefault(method_key, {
            "job_count": 0, "customer_collected_cents": 0,
            "company_retained_cents": 0, "card_fee_cents": 0,
            "collected_by_technician": bool(raw_method) and raw_method not in CARD_PAYMENT_METHODS,
        })
        bucket["job_count"] += 1
        bucket["customer_collected_cents"] += int(row.get("customer_total_cents") or 0)
        bucket["company_retained_cents"] += int(row.get("company_retained_cents") or 0)
        bucket["card_fee_cents"] += int(row.get("card_fee_cents") or 0)
    customer_payment_methods = [
        {"payment_method": method, **bucket}
        for method, bucket in sorted(by_method.items(), key=lambda kv: kv[1]["customer_collected_cents"], reverse=True)
    ]

    # --- revenue composition (period-scoped) ---
    company_provided_items = sum(int(r.get("company_provided_items_cents") or 0) for r in period_rows)
    tax_total = sum(int(r.get("tax_cents") or 0) for r in period_rows)
    tip_total = sum(int(r.get("tip_cents") or 0) for r in period_rows)
    card_fee_total = sum(int(r.get("card_fee_cents") or 0) for r in period_rows)
    commissionable_labor = sum(int(r.get("commissionable_cents") or 0) for r in period_rows)
    composition_accounted = commissionable_labor + company_provided_items + tech_reimbursement + tax_total + tip_total + card_fee_total
    other_non_commissionable = max(0, customer_collected - composition_accounted)
    revenue_composition = {
        "commissionable_labor_cents": commissionable_labor,
        "company_provided_items_cents": company_provided_items,
        "technician_provided_reimbursables_cents": tech_reimbursement,
        "tax_cents": tax_total,
        "tip_cents": tip_total,
        "card_fee_cents": card_fee_total,
        "other_non_commissionable_cents": other_non_commissionable,
    }

    # --- top reimbursable item types (period-scoped, from closeout line items) ---
    # Only technician-provided items are money owed BACK to the tech (matches
    # calculate_settlement's tech_reimbursement_cents rule exactly). Company-
    # provided reimbursable items are a cost the company already covered --
    # they belong in company_provided_items_cents above, not this ranking.
    reimbursable_totals: dict[str, int] = {}
    for row in period_rows:
        for line in ((row.get("closeout") or {}).get("line_items") or []):
            if line.get("reimbursement_eligible") and line.get("provided_by") == "technician":
                code = line.get("item_type_code") or "other"
                reimbursable_totals[code] = reimbursable_totals.get(code, 0) + int(line.get("line_total_cents") or 0)
    top_reimbursable_item_types = [
        {"item_type_code": code, "label": item_labels.get(code, _humanize_code(code)), "amount_cents": amount}
        for code, amount in sorted(reimbursable_totals.items(), key=lambda kv: kv[1], reverse=True)[:5]
    ]

    # --- all-time balances (never period-filtered) ---
    balance_groups = {g["technician_id"]: g for g in aggregate_settlements_by_technician(all_time_rows)}
    payments_by_tech: dict[str, list[dict]] = {}
    for p in payments:
        payments_by_tech.setdefault(str(p.get("technician_id")), []).append(p)
    all_tech_ids = set(balance_groups) | set(payments_by_tech)
    tech_balances = {
        tid: compute_settlement_payment_balance(balance_groups.get(tid), payments_by_tech.get(tid, []))
        for tid in all_tech_ids
    }

    owed_to_technicians = sum(b["outstanding_company_to_tech_cents"] for b in tech_balances.values())
    owed_by_technicians = sum(b["outstanding_tech_to_company_cents"] for b in tech_balances.values())
    pending_confirmation_cents = sum(b["pending_tech_to_company_cents"] for b in tech_balances.values())
    pending_confirmation_count = sum(1 for p in payments if p.get("status") == "pending")

    missing_agreement_tech_ids = {
        tid for tid, g in balance_groups.items() if "missing" in (g.get("agreement_statuses") or [])
    }
    locked_settlement_runs_count = sum(1 for p in periods if p.get("status") == "locked")

    # --- collection by technician (period-scoped collection split; all-time balance) ---
    per_tech_collection: dict[str, dict] = {}
    for row in period_rows:
        tid = str(row.get("technician_id"))
        bucket = per_tech_collection.setdefault(tid, {
            "technician_id": tid,
            "technician_display_name": row.get("technician_display_name"),
            "company_collected_cents": 0,
            "technician_collected_cents": 0,
        })
        if not bucket["technician_display_name"] and row.get("technician_display_name"):
            bucket["technician_display_name"] = row.get("technician_display_name")
        amount = int(row.get("customer_total_cents") or 0)
        raw_method = row.get("payment_method")
        if bool(raw_method) and raw_method not in CARD_PAYMENT_METHODS:
            bucket["technician_collected_cents"] += amount
        else:
            bucket["company_collected_cents"] += amount
    technician_collection = []
    for tid, bucket in per_tech_collection.items():
        balance = tech_balances.get(tid) or compute_settlement_payment_balance(None, [])
        technician_collection.append({
            **bucket,
            "outstanding_company_to_tech_cents": balance["outstanding_company_to_tech_cents"],
            "outstanding_tech_to_company_cents": balance["outstanding_tech_to_company_cents"],
            "pending_confirmation_cents": balance["pending_tech_to_company_cents"],
        })
    technician_collection.sort(
        key=lambda t: t["company_collected_cents"] + t["technician_collected_cents"], reverse=True
    )
    technician_collection = technician_collection[:8]

    # --- top outstanding balances (all-time, non-zero, historical techs included) ---
    ranked_balances = sorted(
        (tid for tid in tech_balances if tech_balances[tid]["net_outstanding_cents"] != 0),
        key=lambda tid: abs(tech_balances[tid]["net_outstanding_cents"]),
        reverse=True,
    )[:5]
    top_balances = [
        {
            "technician_id": tid,
            "technician_display_name": (balance_groups.get(tid) or {}).get("technician_display_name"),
            "affiliation_ended": bool((balance_groups.get(tid) or {}).get("affiliation_ended", False)),
            "affiliation_ended_at": (balance_groups.get(tid) or {}).get("affiliation_ended_at"),
            "balance": tech_balances[tid],
        }
        for tid in ranked_balances
    ]

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "period": {
            "start": period_start,
            "end": period_end,
            "undated_job_count": len(undated_rows),
        },
        "period_metrics": {
            "job_count": job_count,
            "customer_collected_cents": customer_collected,
            "tech_payout_cents": tech_payout,
            "tech_reimbursement_cents": tech_reimbursement,
            "company_retained_cents": company_retained,
            "average_job_cents": int(round(customer_collected / job_count)) if job_count else 0,
        },
        "position": {
            "owed_to_technicians_cents": owed_to_technicians,
            "owed_by_technicians_cents": owed_by_technicians,
            "pending_confirmation_cents": pending_confirmation_cents,
            "pending_confirmation_count": pending_confirmation_count,
        },
        "attention": {
            "pending_payments_count": pending_confirmation_count,
            "settlement_activity_missing_agreement_count": len(missing_agreement_tech_ids),
            "locked_settlement_runs_count": locked_settlement_runs_count,
        },
        "monthly_trend": monthly_trend,
        "job_types": job_types,
        "customer_payment_methods": customer_payment_methods,
        "technician_collection": technician_collection,
        "revenue_composition": revenue_composition,
        "top_reimbursable_item_types": top_reimbursable_item_types,
        "top_balances": top_balances,
    }


def _settlement_payment_in_filters(payment: dict, filters: dict) -> bool:
    technician_id = filters.get("technician_id")
    if technician_id and str(payment.get("technician_id")) != str(technician_id):
        return False
    status = filters.get("status")
    if status and payment.get("status") != status:
        return False
    day = str(payment.get("paid_on") or "")[:10]
    start = filters.get("period_start")
    if start and day < str(start):
        return False
    end = filters.get("period_end")
    if end and day > str(end):
        return False
    return True


def _settlement_row_in_period(row: dict, data: dict) -> bool:
    technician_id = data.get("technician_id")
    if technician_id and str(row.get("technician_id")) != str(technician_id):
        return False
    start = data.get("period_start")
    end = data.get("period_end")
    finished_at = row.get("finished_at")
    if not finished_at:
        return True
    day = str(finished_at)[:10]
    if start and day < str(start):
        return False
    if end and day > str(end):
        return False
    return True


def _new_tracking_token() -> str:
    """Secure, URL-safe customer capability token (~256 bits). Powers the
    /t/{token} tracking + confirm/review/dispute link; never logged."""
    return secrets.token_urlsafe(32)


def _trust_state_value(ticket: Ticket) -> str:
    state = ticket.trust_state
    return state.value if hasattr(state, "value") else str(state)


def _enum_value(value) -> str | None:
    if value is None:
        return None
    return value.value if hasattr(value, "value") else str(value)


def _customer_from_payload(payload: dict) -> tuple[str | None, str | None]:
    """Best-effort bridge until the public Ticket schema grows customer fields."""
    customer = payload.get("customer") if isinstance(payload.get("customer"), dict) else {}
    identity = payload.get("identity") if isinstance(payload.get("identity"), dict) else {}
    phone = (
        payload.get("customer_phone")
        or customer.get("phone")
        or identity.get("phone")
        or identity.get("customer_phone")
    )
    name = (
        payload.get("customer_name")
        or customer.get("name")
        or identity.get("name")
        or identity.get("customer_name")
    )
    return (str(phone) if phone else None, str(name) if name else None)


def _uuid_or_none(value: str | UUID | None) -> UUID | None:
    if value is None:
        return None
    try:
        return value if isinstance(value, UUID) else UUID(str(value))
    except ValueError:
        return None


def _slugify(name: str) -> str:
    out = []
    for ch in (name or "").strip().lower():
        if ch.isalnum():
            out.append(ch)
        elif ch in " -_":
            out.append("-")
    slug = "".join(out).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug or "org"


# Columns a provider may write through the company-profile PATCH. Whitelist used
# to build the dynamic UPDATE — never interpolate arbitrary client keys into SQL.
# Deliberately excludes logo_url (set only via the logo-upload endpoint) and the
# operational dispatch_mode / fulfillment_policy.
COMPANY_PROFILE_COLUMNS = (
    "display_name", "legal_name", "description",
    "contact_name", "contact_title", "contact_email", "contact_phone",
    "address_line1", "address_line2", "city", "region", "postal_code", "country_code",
    "phone", "email", "website", "customer_care_phone",
    "google_profile_url", "google_review_url", "service_postal_codes",
    "service_area_center_lat", "service_area_center_lng", "service_area_radius_km",
)


class Store:
    async def startup(self) -> None:  # pragma: no cover - interface
        ...

    async def get(self, ticket_id: UUID) -> Ticket | None:  # pragma: no cover
        raise NotImplementedError

    async def save(self, ticket: Ticket, origin: dict | None = None) -> None:  # pragma: no cover
        raise NotImplementedError

    async def resolve_intake_channel(self, slug: str | None) -> dict | None:  # pragma: no cover
        """Trusted server-side slug -> owning-org resolution (SYSTEM-DESIGN §20.4).

        Returns {origin_org_id, customer_owner_org_id, intake_channel_id} for a
        known active channel, else None (public ClueXP intake). A browser-supplied
        org id is never trusted — only this lookup confers tenancy."""
        return None

    async def log_event(self, ticket: Ticket, event: str) -> None:  # pragma: no cover
        raise NotImplementedError

    # --- global_settings: runtime operational settings (not secrets) ---
    async def get_global_setting(self, key: str) -> dict | None:  # pragma: no cover
        return None

    async def list_global_settings(self) -> list[dict]:  # pragma: no cover
        return []

    async def upsert_global_setting(
        self, key: str, value: object, value_type: str, updated_by: str | None = None
    ) -> dict:  # pragma: no cover
        raise NotImplementedError

    async def list_service_catalog(self, active_only: bool = False) -> list[dict]:  # pragma: no cover
        return []

    async def upsert_service_category(self, data: dict, updated_by: str | None = None) -> dict:  # pragma: no cover
        raise NotImplementedError

    async def upsert_service_skill(self, data: dict, updated_by: str | None = None) -> dict:  # pragma: no cover
        raise NotImplementedError

    async def list_closeout_item_types(self, active_only: bool = False) -> list[dict]:  # pragma: no cover
        return []

    async def upsert_closeout_item_type(self, data: dict, updated_by: str | None = None) -> dict:  # pragma: no cover
        raise NotImplementedError

    async def list_organization_capabilities(self, organization_id: str) -> list[str]:  # pragma: no cover
        return []

    async def replace_organization_capabilities(
        self, organization_id: str, skill_codes: list[str], updated_by: str | None = None
    ) -> list[str]:  # pragma: no cover
        raise NotImplementedError

    # --- organization_settings: per-provider overrides of org_overridable keys ---
    async def get_organization_setting(self, organization_id: str, key: str) -> dict | None:  # pragma: no cover
        return None

    async def upsert_organization_setting(
        self, organization_id: str, key: str, value: object, value_type: str, updated_by: str | None = None
    ) -> dict:  # pragma: no cover
        raise NotImplementedError

    async def delete_organization_setting(self, organization_id: str, key: str) -> None:  # pragma: no cover
        return None

    async def record_media(
        self,
        *,
        owner_type: str,
        owner_id: UUID,
        kind: str,
        bucket: str,
        path: str,
        visibility: str,
    ) -> str:  # pragma: no cover
        raise NotImplementedError

    async def authenticate_user(self, identifier: str, password: str) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def login_rate_limited(self, identifier: str) -> bool:  # pragma: no cover
        return False

    async def record_login_attempt(
        self, identifier: str, *, success: bool, ip: str | None
    ) -> None:  # pragma: no cover
        return None

    async def get_user_session(self, user_id: str) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def register_technician(self, data: dict) -> dict:  # pragma: no cover
        raise NotImplementedError

    async def register_organization(self, data: dict) -> dict:  # pragma: no cover
        raise NotImplementedError

    # --- console: platform-wide directories (Postgres-only, like list_pending_registrations) ---
    async def list_organizations(self, status: str | None = None) -> list[dict]:  # pragma: no cover
        return []

    async def get_organization_admin_detail(self, organization_id: UUID) -> dict | None:  # pragma: no cover
        return None

    async def list_technicians_admin(self, status: str | None = None) -> list[dict]:  # pragma: no cover
        return []

    async def get_technician_admin_detail(self, technician_id: UUID) -> dict | None:  # pragma: no cover
        return None

    # --- console: platform-wide user directory (company staff + platform admins) ---
    async def list_company_users_admin(self, organization_id: UUID | None = None) -> list[dict]:  # pragma: no cover
        return []

    async def list_platform_admins(self) -> list[dict]:  # pragma: no cover
        return []

    async def get_user_admin_detail(self, user_id: UUID) -> dict | None:  # pragma: no cover
        return None

    async def set_user_account_status(self, user_id: UUID, status: str) -> dict | None:  # pragma: no cover
        return None

    async def update_organization_member_role(
        self, user_id: UUID, organization_id: UUID, role: str
    ) -> dict | None:  # pragma: no cover
        return None

    async def delete_or_archive_user(self, user_id: UUID, *, reason: str) -> dict | None:  # pragma: no cover
        return None

    async def create_platform_admin(self, data: dict) -> dict:  # pragma: no cover
        raise NotImplementedError

    async def count_active_platform_admins(self) -> int:  # pragma: no cover
        return 0

    # --- console/provider: org membership + tenant-limit enforcement ---
    async def list_organization_members(self, organization_id: UUID) -> list[dict]:  # pragma: no cover
        return []

    async def count_organization_members(self, organization_id: UUID) -> int:  # pragma: no cover
        return 0

    async def create_organization_member(
        self, organization_id: UUID, data: dict, *, role: str
    ) -> dict:  # pragma: no cover
        """Add a user + active membership to an existing organization. Raises
        ValueError('email_taken') / ValueError('phone_taken') on conflict."""
        raise NotImplementedError

    async def count_organization_technician_slots(self, organization_id: UUID) -> int:  # pragma: no cover
        """Open affiliation periods (active/suspended/pending_invite) plus pending,
        unexpired technician invites — the occupied slots against max_technicians_per_org."""
        return 0

    async def approve_technician(self, technician_id: UUID) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def set_technician_status(self, technician_id: UUID, status: str) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def approve_organization(self, organization_id: UUID) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def set_organization_status(self, organization_id: UUID, status: str) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def delete_or_archive_organization(self, organization_id: UUID, *, reason: str) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def reject_technician(self, technician_id: UUID) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def reject_organization(self, organization_id: UUID) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def delete_or_archive_technician(self, technician_id: UUID, *, reason: str) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def record_governance_event(
        self,
        *,
        entity_type: str,
        entity_id: UUID,
        action: str,
        reason: str | None = None,
        actor_id: UUID | str | None = None,
        metadata: dict | None = None,
    ) -> dict:  # pragma: no cover
        raise NotImplementedError

    async def list_governance_events(
        self, entity_type: str, entity_id: UUID, *, limit: int = 50
    ) -> list[dict]:  # pragma: no cover
        return []

    async def update_user_locale(self, user_id: str, locale: str) -> None:  # pragma: no cover
        raise NotImplementedError

    async def update_user_profile(
        self, user_id: str, data: dict
    ) -> dict | None | str:  # pragma: no cover
        """Self-service identity update (display_name/email/phone). Returns the
        updated {id, display_name, email, phone}, ``None`` if the user doesn't
        exist, or the string ``"email_taken"``/``"phone_taken"`` on conflict."""
        raise NotImplementedError

    async def change_user_password(
        self, user_id: str, current_password: str, new_password: str
    ) -> bool:  # pragma: no cover
        """Verify ``current_password`` and set ``new_password``. Returns False
        (no change made) if the user is missing or the current password is wrong."""
        raise NotImplementedError

    async def update_technician_profile(
        self, technician_id: UUID, data: dict
    ) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def list_pending_registrations(self) -> list[dict]:  # pragma: no cover
        return []

    async def list_pending_documents(self) -> list[dict]:  # pragma: no cover
        return []

    async def list_pending_technician_photos(self) -> list[dict]:  # pragma: no cover
        return []

    async def get_provider_document(self, document_id: UUID) -> dict | None:  # pragma: no cover
        return None

    async def get_provider_workspace(self, organization_id: UUID) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def update_organization_profile(
        self, organization_id: UUID, data: dict
    ) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def update_company_profile(
        self, organization_id: UUID, data: dict
    ) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def set_organization_logo(
        self, organization_id: UUID, logo_url: str
    ) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def create_team(self, organization_id: UUID, data: dict) -> dict:  # pragma: no cover
        raise NotImplementedError

    async def update_team(
        self, organization_id: UUID, team_id: UUID, data: dict
    ) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def delete_team(
        self, organization_id: UUID, team_id: UUID
    ) -> str | None:  # pragma: no cover
        raise NotImplementedError

    async def add_team_technician(
        self, organization_id: UUID, team_id: UUID, technician_id: UUID, *, role: str | None = None
    ) -> dict:  # pragma: no cover
        raise NotImplementedError

    async def remove_team_technician(
        self, organization_id: UUID, team_id: UUID, technician_id: UUID
    ) -> bool:  # pragma: no cover
        raise NotImplementedError

    async def get_provider_technician_detail(
        self, organization_id: UUID, technician_id: UUID
    ) -> dict | None:  # pragma: no cover
        return None

    async def create_affiliated_technician(
        self, organization_id: UUID, data: dict
    ) -> dict:  # pragma: no cover
        raise NotImplementedError

    async def add_affiliation(
        self, organization_id: UUID, technician_id: UUID, *,
        status: str = "active", affiliation_type: str = "unknown",
        exclusivity: str = "unknown", dispatch_allowed: bool = True,
    ) -> dict:  # pragma: no cover
        raise NotImplementedError

    async def backfill_affiliations_from_primary_org(self) -> int:  # pragma: no cover
        raise NotImplementedError

    async def end_affiliation(
        self, organization_id: UUID, technician_id: UUID, *,
        reason: str | None = None, status: str = "ended",
    ) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def list_affiliated_technicians_directory(
        self, organization_id: UUID
    ) -> list[dict]:  # pragma: no cover
        raise NotImplementedError

    async def create_technician_invite(
        self, organization_id: UUID, *, email: str | None, invited_by: str | None,
    ) -> dict:  # pragma: no cover
        raise NotImplementedError

    async def list_technician_invites(self, organization_id: UUID) -> list[dict]:  # pragma: no cover
        raise NotImplementedError

    async def resolve_technician_invite(self, token: str) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def find_technician_by_email(self, email: str) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def ensure_intake_channel(self, organization_id: UUID) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    # --- technician self-service (Slice D backend) ---
    async def list_technician_affiliations(self, technician_id: UUID) -> list[dict]:  # pragma: no cover
        raise NotImplementedError

    async def list_technician_organizations(self, technician_id: UUID) -> list[dict]:  # pragma: no cover
        raise NotImplementedError

    async def accept_affiliation(self, affiliation_id: UUID, technician_id: UUID) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def decline_affiliation(
        self, affiliation_id: UUID, technician_id: UUID, *, reason: str | None = None
    ) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def set_technician_photo(self, technician_id: UUID, url: str) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def set_technician_photo_status(self, technician_id: UUID, status: str) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def create_provider_document(
        self, organization_id: UUID, data: dict
    ) -> dict:  # pragma: no cover
        raise NotImplementedError

    async def review_provider_document(
        self, document_id: UUID, *, status: str, reviewer_id: UUID | None
    ) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    # --- technician documents (Slice T6) ---
    async def list_technician_documents(self, technician_id: UUID) -> list[dict]:  # pragma: no cover
        raise NotImplementedError

    async def create_technician_document(
        self, technician_id: UUID, data: dict
    ) -> dict:  # pragma: no cover
        raise NotImplementedError

    async def review_technician_document(
        self, document_id: UUID, *, status: str, reviewer_id: UUID | None, reason: str | None = None
    ) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def get_technician_document(self, document_id: UUID, technician_id: UUID) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def list_pending_technician_documents(self) -> list[dict]:  # pragma: no cover
        raise NotImplementedError

    async def get_technician_document_admin(self, document_id: UUID) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def update_technician_location(
        self, technician_id: UUID, *, lat: float, lng: float
    ) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def update_technician_availability(
        self, technician_id: UUID, *, is_available: bool
    ) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def list_technician_offers(self, technician_id: UUID) -> list[dict]:  # pragma: no cover
        raise NotImplementedError

    async def record_review(
        self,
        *,
        ticket_id: UUID,
        rating: int,
        tags: list[str],
        comment: str | None,
    ) -> dict:  # pragma: no cover
        raise NotImplementedError

    async def get_dispatch_job(self, job_id: UUID) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def list_available_technicians(self) -> list[dict]:  # pragma: no cover
        raise NotImplementedError

    async def create_dispatch_offers(
        self, job_id: UUID, ranked: list[dict], expires_at: datetime
    ) -> list[dict]:  # pragma: no cover
        raise NotImplementedError

    async def accept_dispatch_offer(self, offer_id: UUID) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def bump_dispatch_attempt(self, job_id: UUID) -> int:  # pragma: no cover
        raise NotImplementedError

    async def expire_stale_offers(self) -> int:  # pragma: no cover
        raise NotImplementedError

    async def list_dispatchable_jobs(
        self, *, max_attempts: int, total_timeout_seconds: int, limit: int = 100
    ) -> list[dict]:  # pragma: no cover
        raise NotImplementedError

    async def get_dispatch_status(
        self, ticket_id: UUID, *, max_attempts: int, total_timeout_seconds: int
    ) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    # --- fulfillment cutover (Sprint 3) ---
    async def get_tracking_token(self, job_id: UUID) -> str | None:  # pragma: no cover
        raise NotImplementedError

    async def resolve_tracking_token(self, token: str) -> str | None:  # pragma: no cover
        raise NotImplementedError

    async def get_tracking_by_token(
        self, token: str, *, max_attempts: int, total_timeout_seconds: int
    ) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def get_customer_owner_phone(self, job_id: UUID) -> str | None:
        """Owning provider's dispatch phone for the customer UI. None when the
        job has no owning org (public intake) or the store has no org data."""
        return None

    async def get_job_lifecycle(self, job_id: UUID) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def get_technician_active_job(self, technician_id: UUID) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def decline_dispatch_offer(
        self, offer_id: UUID, technician_id: UUID, reason: str | None = None
    ) -> bool:  # pragma: no cover
        raise NotImplementedError

    async def get_ops_technician(
        self, technician_id: UUID, org_id: str | None = None
    ) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def ops_create_single_offer(
        self, job_id: UUID, technician_id: UUID, org_id: UUID | None, expires_at: datetime
    ) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def set_job_status(
        self,
        job_id: UUID,
        new_status: str,
        *,
        expected_current: str | None = None,
        extra_timestamps: list[str] | None = None,
    ) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def create_arrival_pin(
        self, job_id: UUID, technician_id: UUID, pin_hash: str,
        expires_at: datetime, max_attempts: int,
    ) -> None:  # pragma: no cover
        raise NotImplementedError

    async def verify_arrival_pin(
        self, job_id: UUID, technician_id: UUID, pin_hash: str
    ) -> dict:  # pragma: no cover
        raise NotImplementedError

    async def get_provider_active_jobs(self, org_id: str) -> list[dict]:  # pragma: no cover
        raise NotImplementedError

    async def recover_job(
        self, job_id: UUID, *, target_status: str, expected_statuses: list[str],
        clear_technician: bool = False, reason: str | None = None, audit_label: str = "recover",
    ) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def add_job_note(
        self, job_id: UUID, *, author_id: str, author_name: str | None, body: str
    ) -> dict:  # pragma: no cover
        raise NotImplementedError

    async def list_job_notes(self, job_id: UUID) -> list[dict]:  # pragma: no cover
        raise NotImplementedError

    async def list_job_events(self, job_id: UUID) -> list[dict]:  # pragma: no cover
        raise NotImplementedError

    async def list_org_events(self, org_id: str, *, limit: int = 200) -> list[dict]:  # pragma: no cover
        raise NotImplementedError

    async def record_customer_review(
        self,
        *,
        job_id: UUID,
        rating: int,
        comment: str | None,
        issue_reported: bool = False,
        imply_confirm: bool = False,
    ) -> dict:  # pragma: no cover
        raise NotImplementedError

    async def record_payment_report(
        self, *, job_id: UUID, reported_by: str, amount: float, method: str,
        currency: str = "USD",
    ) -> dict:  # pragma: no cover
        raise NotImplementedError

    async def record_job_closeout(self, closeout: dict) -> dict:  # pragma: no cover
        raise NotImplementedError

    async def get_job_closeout(self, job_id: UUID) -> dict | None:  # pragma: no cover
        return None

    async def get_payment_reports(self, job_id: UUID) -> dict:  # pragma: no cover
        raise NotImplementedError

    async def get_job_review(self, job_id: UUID) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def get_provider_job_history(
        self, org_id: str, *, limit: int = 100, offset: int = 0
    ) -> list[dict]:  # pragma: no cover
        raise NotImplementedError

    async def get_provider_financial_overview(
        self, org_id: str, *, period_start: str | None = None, period_end: str | None = None
    ) -> dict:  # pragma: no cover
        raise NotImplementedError

    async def get_provider_technician_agreement(
        self, organization_id: UUID, technician_id: UUID
    ) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def upsert_provider_technician_agreement(
        self, organization_id: UUID, technician_id: UUID, data: dict, *, updated_by: str | None = None
    ) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def list_provider_settlements(
        self, org_id: str, *, technician_id: str | None = None,
        period_start: str | None = None, period_end: str | None = None,
        limit: int = 100,
    ) -> list[dict]:  # pragma: no cover
        raise NotImplementedError

    async def list_technician_settlements(
        self, technician_id: UUID, *, limit: int = 100
    ) -> dict:  # pragma: no cover
        raise NotImplementedError

    async def create_provider_settlement_period(
        self, org_id: str, data: dict, *, created_by: str | None = None
    ) -> dict:  # pragma: no cover
        raise NotImplementedError

    async def list_provider_settlement_periods(
        self, org_id: str, *, limit: int = 50, offset: int = 0
    ) -> list[dict]:  # pragma: no cover
        raise NotImplementedError

    async def get_provider_settlement_period(
        self, org_id: str, period_id: UUID
    ) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def lock_provider_settlement_period(
        self, org_id: str, period_id: UUID, *, actor_id: str | None = None, note: str | None = None
    ) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def mark_provider_settlement_period_paid(
        self, org_id: str, period_id: UUID, *, actor_id: str | None = None, note: str | None = None
    ) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def add_provider_settlement_adjustment(
        self, org_id: str, period_id: UUID, data: dict, *, actor_id: str | None = None
    ) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def create_settlement_payment(
        self, org_id: str, data: dict, *, submitted_by: str | None,
        submitted_by_role: str, status: str,
    ) -> dict:  # pragma: no cover
        raise NotImplementedError

    async def list_settlement_payments(
        self, org_id: str, *, technician_id: str | None = None,
        status: str | None = None, period_start: str | None = None,
        period_end: str | None = None, limit: int = 500, offset: int = 0,
    ) -> list[dict]:  # pragma: no cover
        raise NotImplementedError

    async def confirm_settlement_payment(
        self, org_id: str, payment_id: UUID, *, actor_id: str | None = None
    ) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def reject_settlement_payment(
        self, org_id: str, payment_id: UUID, *, actor_id: str | None = None, reason: str
    ) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def void_settlement_payment(
        self, org_id: str, payment_id: UUID, *, actor_id: str | None = None, reason: str
    ) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def list_technician_settlement_payments(
        self, technician_id: UUID, *, limit: int = 200
    ) -> list[dict]:  # pragma: no cover
        raise NotImplementedError

    async def get_technician_job_history(
        self, technician_id: UUID, *, limit: int = 100
    ) -> list[dict]:  # pragma: no cover
        raise NotImplementedError

    async def auto_close_pending(self, window_seconds: int) -> int:  # pragma: no cover
        raise NotImplementedError

    async def cancel_job(
        self, job_id: UUID, *, current_status: str, reason: str | None = None
    ) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def resolve_job(
        self, job_id: UUID, *, action: str, note: str | None = None
    ) -> dict | None:  # pragma: no cover
        raise NotImplementedError

    async def log_event_raw(self, job_id: UUID, event: str) -> None:  # pragma: no cover
        raise NotImplementedError


class InMemoryStore(Store):
    def __init__(self) -> None:
        self._tickets: dict[UUID, Ticket] = {}
        self.events: list[str] = []
        self.media: list[dict[str, str]] = []
        # Runtime operational settings — derived from the settings registry so the
        # in-memory store behaves like a freshly-migrated DB (the migration seeds use
        # the same per-key fallback). Never holds secrets.
        self._global_settings: dict[str, dict] = {
            spec.key: {
                "key": spec.key,
                "value": spec.fallback,
                "value_type": spec.value_type,
                "description": spec.description,
                "is_secret": spec.is_secret,
                "is_runtime_editable": spec.is_runtime_editable,
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "updated_by": None,
            }
            for spec in runtime_settings.SETTINGS.values()
        }
        # Per-org overrides of org_overridable settings: (organization_id, key) -> row.
        self._organization_settings: dict[tuple[str, str], dict] = {}
        self._service_categories: dict[str, dict] = {}
        self._service_skills: dict[str, dict] = {}
        self._closeout_item_types: dict[str, dict] = {}
        self._job_closeouts: dict[str, dict] = {}
        self._technician_agreements: dict[tuple[str, str], dict] = {}
        self._settlement_periods: dict[str, dict] = {}
        self._organization_capabilities: dict[str, set[str]] = {}
        self._organizations: dict[str, dict] = {
            "org-metro": {
                "id": "org-metro", "display_name": "Metro Key Partners",
                "status": "active", "service_postal_codes": [],
            }
        }
        for category in default_service_catalog():
            cat = {k: v for k, v in category.items() if k != "skills"}
            self._service_categories[cat["code"]] = cat
            for skill in category.get("skills", []):
                self._service_skills[skill["code"]] = {
                    **skill,
                    "category_code": cat["code"],
                }
        for item_type in default_closeout_item_types():
            self._closeout_item_types[item_type["code"]] = dict(item_type)
        self._organization_capabilities["org-metro"] = {
            skill["code"]
            for skill in self._service_skills.values()
            if skill.get("status") == "active"
        }
        password_hash = hash_password(DEMO_PASSWORD, salt="cluexp-demo-salt")
        self.users: dict[str, dict] = {
            "usr_platform_demo": {
                "id": "usr_platform_demo",
                "email": "avery@cluexp.com",
                "phone": None,
                "display_name": "Avery Knox",
                "password_hash": password_hash,
                "roles": ["platform_admin"],
                "active_organization_id": None,
                "organization_name": None,
            },
            "usr_provider_demo": {
                "id": "usr_provider_demo",
                "email": "dispatch@metrokey.example",
                "phone": "+15550140199",
                "display_name": "Nadia Reyes",
                "password_hash": password_hash,
                "roles": ["provider_admin", "dispatcher"],
                "active_organization_id": "org-metro",
                "organization_name": "Metro Key Partners",
            },
            "usr_tech_demo": {
                "id": "usr_tech_demo",
                "email": "jordan@cluexp.example",
                "phone": "+15550142201",
                "display_name": "Jordan Lee",
                "password_hash": password_hash,
                "roles": ["technician"],
                "active_organization_id": None,
                "organization_name": None,
            },
        }
        self.reviews: list[dict] = []
        self.login_attempts: list[dict] = []
        self.governance_events: list[dict] = []
        # Technician documents for Slice T6
        self.technician_documents: list[dict] = []

    async def get(self, ticket_id: UUID) -> Ticket | None:
        return self._tickets.get(ticket_id)

    async def save(self, ticket: Ticket, origin: dict | None = None) -> None:
        self._tickets[ticket.ticket_id] = ticket

    async def resolve_intake_channel(self, slug: str | None) -> dict | None:
        # No DB locally — public ClueXP intake (no owning org).
        return None

    async def log_event(self, ticket: Ticket, event: str) -> None:
        stamp = datetime.now(timezone.utc).isoformat()
        self.events.append(f"{stamp} {ticket.ticket_id} {event} {_trust_state_value(ticket)}")

    async def record_media(
        self,
        *,
        owner_type: str,
        owner_id: UUID,
        kind: str,
        bucket: str,
        path: str,
        visibility: str,
    ) -> str:
        media_id = str(uuid4())
        self.media.append(
            {
                "id": media_id,
                "owner_type": owner_type,
                "owner_id": str(owner_id),
                "kind": kind,
                "bucket": bucket,
                "path": path,
                "visibility": visibility,
            }
        )
        return media_id

    async def authenticate_user(self, identifier: str, password: str) -> dict | None:
        normalized = identifier.strip().lower()
        for user in self.users.values():
            if normalized not in {str(user.get("email") or "").lower(), str(user.get("phone") or "")}:
                continue
            if not verify_password(password, user.get("password_hash")):
                return None
            return await self.get_user_session(user["id"])
        return None

    async def get_user_session(self, user_id: str) -> dict | None:
        user = self.users.get(user_id)
        if not user:
            return None
        tech = next((t for t in getattr(self, "_technicians", []) if str(t.get("id")) == str(user_id)), None)
        return {
            "user": {
                "id": user["id"],
                "email": user["email"],
                "phone": user["phone"],
                "display_name": user["display_name"],
            },
            "roles": user["roles"],
            "active_organization_id": user["active_organization_id"],
            "organization_name": user["organization_name"],
            "technician": (
                {
                    "id": str(tech["id"]),
                    "status": tech.get("status"),
                    "vetting_status": tech.get("vetting_status"),
                    "is_available": tech.get("is_available", True),
                    "display_name": tech.get("display_name"),
                    "phone": tech.get("phone"),
                    "skills": list(tech.get("skills") or []),
                    "service_area_radius_km": tech.get("service_area_radius_km"),
                    "approved": tech.get("status") == "active" and tech.get("vetting_status") == "verified",
                    "photo_url": tech.get("profile_photo_url"),
                    "photo_status": tech.get("profile_photo_status") or "none",
                    "location_updated_at": tech.get("location_updated_at"),
                    "affiliations": [],
                }
                if tech
                else None
            ),
        }

    async def list_pending_registrations(self) -> list[dict]:
        return []

    async def list_pending_documents(self) -> list[dict]:
        return []

    async def list_pending_technician_photos(self) -> list[dict]:
        return [
            {
                "technician_id": str(tech.get("id")),
                "display_name": tech.get("display_name"),
                "email": tech.get("email"),
                "phone": tech.get("phone"),
                "photo_url": tech.get("profile_photo_url"),
                "photo_status": tech.get("profile_photo_status") or "none",
                "status": tech.get("status"),
                "vetting_status": tech.get("vetting_status"),
            }
            for tech in getattr(self, "_technicians", [])
            if tech.get("profile_photo_url") and tech.get("profile_photo_status") == "pending"
        ]

    async def get_provider_document(self, document_id: UUID) -> dict | None:
        return None

    async def get_provider_workspace(self, organization_id: UUID) -> dict | None:
        oid = str(organization_id)
        techs = getattr(self, "_technicians", [])
        affs = getattr(self, "_affiliations", [])
        open_rows = [
            a for a in affs
            if str(a.get("organization_id")) == oid and a.get("ended_at") is None
        ]
        technicians = []
        for aff in open_rows:
            tech = next((t for t in techs if str(t.get("id")) == str(aff.get("technician_id"))), None)
            if tech is None:
                continue
            technicians.append({
                "id": str(tech.get("id")),
                "display_name": tech.get("display_name"),
                "email": tech.get("email"),
                "phone": tech.get("phone"),
                "status": tech.get("status", "active"),
                "global_status": tech.get("status", "active"),
                "vetting_status": tech.get("vetting_status"),
                "skills": tech.get("skills") or [],
                "provider_type": tech.get("provider_type"),
                "is_available": tech.get("is_available"),
                "affiliation": {
                    "status": aff.get("status"),
                    "affiliation_type": aff.get("affiliation_type"),
                    "exclusivity": aff.get("exclusivity"),
                    "dispatch_allowed": bool(aff.get("dispatch_allowed")),
                    "ended_at": aff.get("ended_at"),
                    "is_pending_invite": aff.get("status") == "pending_invite",
                },
                "team_ids": [],
            })
        rec = self._org_record(organization_id)
        profile_keys = (
            "legal_name", "description", "slug", "phone", "email",
            "service_area_center_lat", "service_area_center_lng", "service_area_radius_km",
            "dispatch_mode", "fulfillment_policy",
            "contact_name", "contact_title", "contact_email", "contact_phone",
            "address_line1", "address_line2", "city", "region", "postal_code", "country_code",
            "website", "customer_care_phone", "google_profile_url", "google_review_url",
            "logo_url",
        )
        organization = {
            "id": rec["id"],
            "display_name": rec.get("display_name"),
            "status": rec.get("status", "active"),
            "service_postal_codes": list(rec.get("service_postal_codes") or []),
            **{key: rec.get(key) for key in profile_keys},
        }
        return {
            "organization": organization,
            "teams": [],
            "technicians": technicians,
            "documents": [],
        }

    def _org_record(self, organization_id: UUID) -> dict:
        oid = str(organization_id)
        rec = self._organizations.get(oid)
        if rec is None:
            rec = {
                "id": oid, "display_name": "Local provider",
                "status": "active", "service_postal_codes": [],
            }
            self._organizations[oid] = rec
        return rec

    async def update_organization_profile(self, organization_id: UUID, data: dict) -> dict | None:
        rec = self._org_record(organization_id)
        rec.update(data)
        return {
            "id": rec["id"], "display_name": rec.get("display_name"),
            "status": rec.get("status", "active"),
        }

    async def update_company_profile(self, organization_id: UUID, data: dict) -> dict | None:
        rec = self._org_record(organization_id)
        for column in COMPANY_PROFILE_COLUMNS:
            if column in data:
                rec[column] = data[column]
        return {
            "id": rec["id"], "display_name": rec.get("display_name"),
            "status": rec.get("status", "active"),
        }

    async def set_organization_logo(self, organization_id: UUID, logo_url: str) -> dict | None:
        rec = self._org_record(organization_id)
        rec["logo_url"] = logo_url
        return {"id": rec["id"], "logo_url": logo_url}

    async def list_affiliated_technicians_directory(self, organization_id: UUID) -> list[dict]:
        oid = str(organization_id)
        techs = getattr(self, "_technicians", [])
        affs = getattr(self, "_affiliations", [])
        out: list[dict] = []
        for aff in affs:
            if str(aff.get("organization_id")) != oid or aff.get("ended_at") is not None:
                continue
            tech = next((t for t in techs if str(t.get("id")) == str(aff.get("technician_id"))), None)
            if tech is None:
                continue
            active = tech.get("status") == "active"
            availability = "free" if (active and tech.get("is_available")) else "offline"
            out.append({
                "id": str(tech.get("id")),
                "display_name": tech.get("display_name"),
                "email": tech.get("email"),
                "phone": tech.get("phone"),
                "profile_photo_url": tech.get("profile_photo_url") if tech.get("profile_photo_status") == "approved" else None,
                "profile_photo_status": tech.get("profile_photo_status"),
                "status": tech.get("status", "active"),
                "vetting_status": tech.get("vetting_status"),
                "skills": tech.get("skills") or [],
                "is_available": tech.get("is_available"),
                "availability": availability,
                "rating": tech.get("rating"),
                "location_updated_at": tech.get("location_updated_at"),
                "affiliation": {
                    "status": aff.get("status"),
                    "affiliation_type": aff.get("affiliation_type"),
                    "exclusivity": aff.get("exclusivity"),
                    "dispatch_allowed": bool(aff.get("dispatch_allowed")),
                    "affiliated_at": aff.get("starts_at"),
                    "is_pending_invite": aff.get("status") == "pending_invite",
                },
                "completed_jobs": 0,
                "compliance": {
                    "total": 0, "verified": 0, "pending": 0, "rejected": 0,
                    "expired": [], "expiring": [], "summary": "no_documents",
                },
            })
        return out

    async def create_technician_invite(
        self, organization_id: UUID, *, email: str | None, invited_by: str | None,
    ) -> dict:
        invites = self._invites = getattr(self, "_invites", [])
        token = secrets.token_urlsafe(24)
        now = datetime.now(timezone.utc)
        record = {
            "id": str(uuid4()), "organization_id": str(organization_id),
            "email": email, "token": token, "status": "pending",
            "invited_by": invited_by,
            "created_at": now.isoformat(),
            "expires_at": (now + timedelta(days=14)).isoformat(),
            "accepted_at": None,
        }
        invites.append(record)
        return {k: record[k] for k in ("id", "email", "token", "status", "created_at", "expires_at")}

    async def list_technician_invites(self, organization_id: UUID) -> list[dict]:
        oid = str(organization_id)
        return [
            {k: inv.get(k) for k in ("id", "email", "token", "status", "created_at", "expires_at", "accepted_at")}
            for inv in getattr(self, "_invites", [])
            if str(inv.get("organization_id")) == oid
        ]

    async def resolve_technician_invite(self, token: str) -> dict | None:
        for inv in getattr(self, "_invites", []):
            if inv.get("token") == token:
                return {
                    "id": inv["id"], "organization_id": inv["organization_id"],
                    "email": inv.get("email"), "status": inv.get("status"),
                    "expires_at": inv.get("expires_at"), "organization_name": "Local provider",
                }
        return None

    async def find_technician_by_email(self, email: str) -> dict | None:
        target = (email or "").strip().lower()
        for tech in getattr(self, "_technicians", []):
            if str(tech.get("email") or "").strip().lower() == target and target:
                return {"id": str(tech.get("id")), "display_name": tech.get("display_name")}
        return None

    async def ensure_intake_channel(self, organization_id: UUID) -> dict | None:
        return {"slug": f"org-{str(organization_id)[:8]}"}

    async def create_team(self, organization_id: UUID, data: dict) -> dict:
        teams = self._teams = getattr(self, "_teams", [])
        row = {"id": str(uuid4()), "organization_id": str(organization_id), "status": "active", **data}
        teams.append(row)
        return dict(row)

    async def update_team(self, organization_id: UUID, team_id: UUID, data: dict) -> dict | None:
        teams = getattr(self, "_teams", [])
        row = next((t for t in teams if str(t.get("id")) == str(team_id)
                    and str(t.get("organization_id")) == str(organization_id)), None)
        if row is not None:
            row.update(data)
            return dict(row)
        # Fallback for stores seeded without a create_team call.
        return {"id": str(team_id), "organization_id": str(organization_id), **data}

    def _team_in_org(self, organization_id: UUID, team_id: UUID) -> dict | None:
        return next((t for t in getattr(self, "_teams", [])
                     if str(t.get("id")) == str(team_id)
                     and str(t.get("organization_id")) == str(organization_id)), None)

    def _is_active_affiliate(self, organization_id: UUID, technician_id: UUID) -> bool:
        return any(
            str(a.get("organization_id")) == str(organization_id)
            and str(a.get("technician_id")) == str(technician_id)
            and a.get("status") == "active" and a.get("ended_at") is None
            for a in getattr(self, "_affiliations", [])
        )

    async def add_team_technician(
        self, organization_id: UUID, team_id: UUID, technician_id: UUID, *, role: str | None = None
    ) -> dict:
        if self._team_in_org(organization_id, team_id) is None:
            return {"error_code": "team_not_found"}
        if not self._is_active_affiliate(organization_id, technician_id):
            return {"error_code": "not_affiliated"}
        members = self._team_members = getattr(self, "_team_members", [])
        key = (str(team_id), str(technician_id))
        existing = next((m for m in members if (m["team_id"], m["technician_id"]) == key), None)
        if existing is not None:
            existing["role"] = role
            return {"added": False, "team_id": str(team_id), "technician_id": str(technician_id)}
        members.append({"team_id": str(team_id), "technician_id": str(technician_id), "role": role})
        return {"added": True, "team_id": str(team_id), "technician_id": str(technician_id)}

    async def remove_team_technician(
        self, organization_id: UUID, team_id: UUID, technician_id: UUID
    ) -> bool:
        if self._team_in_org(organization_id, team_id) is None:
            return False
        members = getattr(self, "_team_members", [])
        before = len(members)
        self._team_members = [
            m for m in members
            if not (m["team_id"] == str(team_id) and m["technician_id"] == str(technician_id))
        ]
        return len(self._team_members) < before

    async def delete_team(self, organization_id: UUID, team_id: UUID) -> str | None:
        """Safe delete: 404 if not owned; refuse (`has_children`) if active sub-teams
        exist; otherwise drop the team and its memberships."""
        team = self._team_in_org(organization_id, team_id)
        if team is None:
            return None
        children = [t for t in getattr(self, "_teams", [])
                    if str(t.get("parent_team_id")) == str(team_id) and t.get("status") != "archived"]
        if children:
            raise ValueError("has_children")
        self._teams = [t for t in getattr(self, "_teams", []) if str(t.get("id")) != str(team_id)]
        self._team_members = [m for m in getattr(self, "_team_members", []) if m["team_id"] != str(team_id)]
        return "deleted"

    def _review_summary(self, technician_id: UUID, organization_id: UUID | None) -> dict:
        rows = [r for r in getattr(self, "_job_reviews", [])
                if str(r.get("fulfillment_technician_ref")) == str(technician_id)
                and (organization_id is None or str(r.get("fulfillment_org_id")) == str(organization_id))]
        if not rows:
            return {"count": 0, "average": None}
        ratings = [r.get("rating") for r in rows if r.get("rating") is not None]
        avg = round(sum(ratings) / len(ratings), 2) if ratings else None
        return {"count": len(rows), "average": avg}

    async def get_provider_technician_detail(
        self, organization_id: UUID, technician_id: UUID
    ) -> dict | None:
        """Tenant-scoped read-only technician profile for the provider console.
        Returns None when the technician has no open affiliation with this org."""
        aff = next((a for a in getattr(self, "_affiliations", [])
                    if str(a.get("organization_id")) == str(organization_id)
                    and str(a.get("technician_id")) == str(technician_id)
                    and a.get("ended_at") is None), None)
        if aff is None:
            return None
        tech = next((t for t in getattr(self, "_technicians", [])
                     if str(t.get("id")) == str(technician_id)), None) or {}
        photo_approved = tech.get("profile_photo_status") == "approved"
        memberships = [
            {"team_id": m["team_id"], "role": m.get("role"),
             "name": (self._team_in_org(organization_id, UUID(m["team_id"])) or {}).get("name")}
            for m in getattr(self, "_team_members", [])
            if m["technician_id"] == str(technician_id)
            and self._team_in_org(organization_id, UUID(m["team_id"])) is not None
        ]
        docs = await self.list_technician_documents(technician_id)
        return {
            "id": str(technician_id),
            "display_name": tech.get("display_name"),
            "email": tech.get("email"),
            "phone": tech.get("phone"),
            "profile_photo_url": tech.get("profile_photo_url") if photo_approved else None,
            "profile_photo_status": tech.get("profile_photo_status"),
            "status": tech.get("status", "active"),
            "vetting_status": tech.get("vetting_status"),
            "skills": tech.get("skills") or [],
            "rating": float(tech["rating"]) if tech.get("rating") is not None else None,
            "location_updated_at": tech.get("location_updated_at"),
            "affiliation": {
                "status": aff.get("status"),
                "affiliation_type": aff.get("affiliation_type"),
                "exclusivity": aff.get("exclusivity"),
                "dispatch_allowed": bool(aff.get("dispatch_allowed")),
                "affiliated_at": aff.get("starts_at"),
                "is_pending_invite": aff.get("status") == "pending_invite",
            },
            "agreement": await self.get_provider_technician_agreement(organization_id, technician_id),
            "team_memberships": memberships,
            "reviews": {
                "company": self._review_summary(technician_id, organization_id),
                "global": self._review_summary(technician_id, None),
            },
            "documents": docs,
        }

    async def get_provider_technician_agreement(
        self, organization_id: UUID, technician_id: UUID
    ) -> dict | None:
        aff = next((a for a in getattr(self, "_affiliations", [])
                    if str(a.get("organization_id")) == str(organization_id)
                    and str(a.get("technician_id")) == str(technician_id)
                    and a.get("ended_at") is None), None)
        if aff is None:
            return None
        row = self._technician_agreements.get((str(organization_id), str(technician_id)))
        return dict(row) if row is not None else _default_agreement(str(organization_id), str(technician_id))

    async def get_provider_technician_agreement_for_reporting(
        self, organization_id: UUID, technician_id: UUID
    ) -> tuple[dict | None, bool, str | None]:
        """Reporting variant: no open-affiliation gate, so historical rows for a
        tech who left keep their last-known terms instead of collapsing to zero.
        Returns (agreement | None, affiliation_ended, affiliation_ended_at)."""
        affs = [a for a in getattr(self, "_affiliations", [])
                if str(a.get("organization_id")) == str(organization_id)
                and str(a.get("technician_id")) == str(technician_id)]
        ended = bool(affs) and all(a.get("ended_at") is not None for a in affs)
        ended_at = max((a["ended_at"] for a in affs if a.get("ended_at")), default=None) if ended else None
        row = getattr(self, "_technician_agreements", {}).get((str(organization_id), str(technician_id)))
        if row is not None:
            return dict(row), ended, ended_at
        if affs:
            return _default_agreement(str(organization_id), str(technician_id)), ended, ended_at
        return None, False, None

    async def upsert_provider_technician_agreement(
        self, organization_id: UUID, technician_id: UUID, data: dict, *, updated_by: str | None = None
    ) -> dict | None:
        current = await self.get_provider_technician_agreement(organization_id, technician_id)
        if current is None:
            return None
        now = datetime.now(timezone.utc).isoformat()
        row = {
            **current,
            **data,
            "id": current.get("id") or str(uuid4()),
            "organization_id": str(organization_id),
            "technician_id": str(technician_id),
            "created_at": current.get("created_at") or now,
            "updated_at": now,
            "updated_by": updated_by,
        }
        self._technician_agreements[(str(organization_id), str(technician_id))] = row
        return dict(row)

    async def create_affiliated_technician(self, organization_id: UUID, data: dict) -> dict:
        techs = self._technicians = getattr(self, "_technicians", [])
        email = (data.get("email") or "").strip().lower() or None
        phone = (data.get("phone") or "").strip() or None
        # Existing global technician (by email/phone) → attach as a PENDING INVITE,
        # never a duplicate profile or a silent activation (consent required).
        existing = next(
            (t for t in techs
             if (email and str(t.get("email") or "").strip().lower() == email)
             or (phone and str(t.get("phone") or "").strip() == phone)),
            None,
        )
        if existing is not None:
            await self.add_affiliation(
                organization_id, existing["id"], status="pending_invite",
                affiliation_type=data.get("affiliation_type") or "unknown",
                exclusivity=data.get("exclusivity") or "unknown",
                dispatch_allowed=bool(data.get("dispatch_allowed", True)),
            )
            return {
                "id": str(existing["id"]),
                "organization_id": str(organization_id),
                "display_name": existing.get("display_name"),
                "existing": True,
                "status": existing.get("status", "active"),
                "global_status": existing.get("status", "active"),
                "affiliation": {
                    "status": "pending_invite",
                    "affiliation_type": data.get("affiliation_type") or "unknown",
                    "exclusivity": data.get("exclusivity") or "unknown",
                    "dispatch_allowed": bool(data.get("dispatch_allowed", True)),
                    "is_pending_invite": True,
                },
            }
        tid = str(uuid4())
        techs.append({
            "id": tid,
            "display_name": data.get("display_name"),
            "email": data.get("email"),
            "phone": data.get("phone"),
            "status": "pending_vetting",
            "vetting_status": "unverified",
            "skills": data.get("skills") or [],
            "service_area_center_lat": data.get("service_area_center_lat"),
            "service_area_center_lng": data.get("service_area_center_lng"),
            "service_area_radius_km": data.get("service_area_radius_km"),
            "is_available": False,
            "provider_type": "affiliate",
            "primary_organization_id": str(organization_id),  # denormalized cache
        })
        # Affiliation is the source of truth; the exclusive guard may reject this.
        await self.add_affiliation(
            organization_id, UUID(tid),
            affiliation_type=data.get("affiliation_type") or "unknown",
            exclusivity=data.get("exclusivity") or "unknown",
            dispatch_allowed=bool(data.get("dispatch_allowed", True)),
        )
        return {
            "id": tid,
            "organization_id": str(organization_id),
            "status": "pending_vetting",
            "vetting_status": "unverified",
            "global_status": "pending_vetting",
            "affiliation": {
                "status": "active",
                "affiliation_type": data.get("affiliation_type") or "unknown",
                "exclusivity": data.get("exclusivity") or "unknown",
                "dispatch_allowed": bool(data.get("dispatch_allowed", True)),
                "is_pending_invite": False,
            },
            **{key: value for key, value in data.items() if key != "password"},
        }

    async def create_provider_document(self, organization_id: UUID, data: dict) -> dict:
        return {
            "id": str(uuid4()),
            "organization_id": str(organization_id),
            "status": "pending_review",
            **data,
        }

    async def review_provider_document(
        self, document_id: UUID, *, status: str, reviewer_id: UUID | None
    ) -> dict | None:
        return {"id": str(document_id), "status": status}

    async def update_technician_location(
        self, technician_id: UUID, *, lat: float, lng: float
    ) -> dict | None:
        return {"id": str(technician_id), "current_lat": lat, "current_lng": lng}

    async def update_technician_availability(
        self, technician_id: UUID, *, is_available: bool
    ) -> dict | None:
        return {"id": str(technician_id), "is_available": is_available}

    async def record_review(
        self,
        *,
        ticket_id: UUID,
        rating: int,
        tags: list[str],
        comment: str | None,
    ) -> dict:
        ticket = await self.get(ticket_id)
        if ticket is None:
            raise KeyError(str(ticket_id))
        review = {
            "id": str(uuid4()),
            "ticket_id": str(ticket_id),
            "rating": rating,
            "tags": tags,
            "comment": comment,
            "technician_ref": ticket.technician_assignment.technician_id
            if ticket.technician_assignment
            else None,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        self.reviews.append(review)
        return review

    async def get_dispatch_job(self, job_id: UUID) -> dict | None:
        ticket = await self.get(job_id)
        if ticket is None:
            return None
        loc = getattr(ticket, "location", None)
        return {
            "id": str(job_id),
            "lat": getattr(loc, "lat", None),
            "lng": getattr(loc, "lng", None),
            "access_type": ticket.access_type.value if ticket.access_type else None,
            "fulfillment_technician_id": None,
        }

    async def list_available_technicians(self) -> list[dict]:
        return list(getattr(self, "_technicians", []))

    async def create_dispatch_offers(
        self, job_id: UUID, ranked: list[dict], expires_at: datetime
    ) -> list[dict]:
        offers = getattr(self, "_offers", None)
        if offers is None:
            offers = self._offers = {}
        created = []
        for rank, tech in enumerate(ranked):
            rec = {
                "id": str(uuid4()),
                "job_id": str(job_id),
                "technician_id": str(tech["id"]),
                "organization_id": tech.get("primary_organization_id"),
                "rank": rank,
                "status": "offered",
                "dist_km": tech.get("dist_km"),
            }
            offers[rec["id"]] = rec
            created.append(rec)
        return created

    async def accept_dispatch_offer(self, offer_id: UUID) -> dict | None:
        offers = getattr(self, "_offers", {})
        rec = offers.get(str(offer_id))
        if rec is None:
            return None
        if rec["status"] != "offered":
            return {"accepted": False, "reason": rec["status"], "job_id": rec["job_id"]}
        jid = rec["job_id"]
        self._job_status = getattr(self, "_job_status", {})
        self._job_tech = getattr(self, "_job_tech", {})
        # Guard: only accept if the job is still pending_dispatch. A concurrent
        # cancellation would have changed the status, and we must not flip
        # trust_state or assign the technician on a cancelled/changed job.
        if self._job_status.get(jid) != STATUS_PENDING_DISPATCH:
            rec["status"] = "superseded"
            return {"accepted": False, "reason": "job_not_pending", "job_id": jid}
        rec["status"] = "accepted"
        for other in offers.values():
            if (
                other["job_id"] == jid
                and other["id"] != rec["id"]
                and other["status"] == "offered"
            ):
                other["status"] = "superseded"
        self._job_status[jid] = STATUS_ASSIGNED
        self._job_tech[jid] = rec["technician_id"]
        return {
            "accepted": True,
            "job_id": jid,
            "technician_id": rec["technician_id"],
            "organization_id": rec.get("organization_id"),
        }

    async def bump_dispatch_attempt(self, job_id: UUID) -> int:
        self._attempts = getattr(self, "_attempts", {})
        self._attempts[str(job_id)] = self._attempts.get(str(job_id), 0) + 1
        return self._attempts[str(job_id)]

    async def expire_stale_offers(self) -> int:
        return 0

    async def get_ops_queue(self, org_id: str | None = None) -> list[dict]:
        statuses = getattr(self, "_job_status", {})
        offers = getattr(self, "_offers", {})
        job_org = getattr(self, "_job_org", {})
        result = []
        for jid, status in statuses.items():
            if status != STATUS_PENDING_DISPATCH:
                continue
            owner_org = job_org.get(jid)
            if org_id is not None and owner_org != str(org_id):
                continue
            active_offer = next(
                (o for o in offers.values() if o.get("job_id") == jid and o.get("status") == "offered"),
                None,
            )
            declined = [
                o for o in offers.values()
                if o.get("job_id") == jid and o.get("status") == "declined"
            ]
            last_decline_reason = declined[-1].get("decline_reason") if declined else None
            result.append({
                "id": jid, "address": None, "lat": None, "lng": None,
                "access_type": None, "situation": None, "urgency": None,
                "created_at": None, "customer_owner_org_id": owner_org,
                "fulfillment_policy": None, "dispatch_attempts": 0,
                "detail": getattr(self, "_job_detail", {}).get(jid, {}),
                "offer_active": active_offer is not None,
                "offer_id": active_offer["id"] if active_offer else None,
                "offered_technician_id": active_offer["technician_id"] if active_offer else None,
                "offer_expires_at": None,
                "decline_count": len(declined),
                "last_decline_reason": last_decline_reason,
                "photo_count": len(getattr(self, "_job_photo_paths", {}).get(jid, [])),
                "photo_paths": list(getattr(self, "_job_photo_paths", {}).get(jid, [])),
            })
        return result

    def _tech_eligible_for_org(self, tech: dict, org_id: str) -> bool:
        """Slice A eligibility: an active, dispatch-allowed, non-ended affiliation row
        for this org — or, only when the technician has NO affiliation rows yet, the
        legacy primary_organization_id denormalized cache."""
        tid = str(tech.get("id"))
        affs = [a for a in getattr(self, "_affiliations", []) if str(a.get("technician_id")) == tid]
        active_here = any(
            str(a.get("organization_id")) == str(org_id)
            and a.get("status") == "active"
            and a.get("dispatch_allowed", True)
            and a.get("ended_at") is None
            for a in affs
        )
        if active_here:
            return True
        if not affs:
            return str(tech.get("primary_organization_id")) == str(org_id)
        return False

    async def list_all_technicians_for_ops(self, org_id: str | None = None) -> list[dict]:
        techs = list(getattr(self, "_technicians", []))
        if org_id is not None:
            techs = [t for t in techs if self._tech_eligible_for_org(t, org_id)]
        return techs

    async def add_affiliation(
        self, organization_id: UUID, technician_id: UUID, *,
        status: str = "active", affiliation_type: str = "unknown",
        exclusivity: str = "unknown", dispatch_allowed: bool = True,
    ) -> dict:
        """Create/upsert a provider affiliation, enforcing the same guard as the DB
        partial unique index: at most one active EXCLUSIVE affiliation per technician
        (across orgs). Raises ValueError('exclusive_conflict') on violation."""
        affs = self._affiliations = getattr(self, "_affiliations", [])
        oid, tid = str(organization_id), str(technician_id)
        if status == "active" and exclusivity == "exclusive":
            for a in affs:
                if (str(a.get("technician_id")) == tid and a.get("status") == "active"
                        and a.get("exclusivity") == "exclusive" and a.get("ended_at") is None
                        and str(a.get("organization_id")) != oid):
                    raise ValueError("exclusive_conflict")
        # Upsert the OPEN period for (org, tech); if none is open (e.g. the prior
        # period was ended), start a NEW period row so history is preserved.
        row = next((a for a in affs if str(a.get("organization_id")) == oid
                    and str(a.get("technician_id")) == tid and a.get("ended_at") is None), None)
        new = row is None
        row = row or {"id": str(uuid4()), "organization_id": oid, "technician_id": tid}
        row.update({
            "status": status, "affiliation_type": affiliation_type,
            "exclusivity": exclusivity, "dispatch_allowed": dispatch_allowed,
            "ended_at": None, "ended_reason": None,
        })
        if new:
            affs.append(row)
        return dict(row)

    async def end_affiliation(
        self, organization_id: UUID, technician_id: UUID, *,
        reason: str | None = None, status: str = "ended",
    ) -> dict | None:
        """Close the OPEN affiliation period for (org, tech). `status='ended'` sets
        `ended_at` (so a later rejoin starts a new period); `status='suspended'` keeps
        the period open but dispatch-ineligible. Returns None if no open period."""
        affs = getattr(self, "_affiliations", [])
        oid, tid = str(organization_id), str(technician_id)
        row = next((a for a in affs if str(a.get("organization_id")) == oid
                    and str(a.get("technician_id")) == tid and a.get("ended_at") is None), None)
        if row is None:
            return None
        row["status"] = status
        if status == "ended":
            row["ended_at"] = datetime.now(timezone.utc).isoformat()
            row["ended_reason"] = reason
        else:
            row["suspension_reason"] = reason
        return dict(row)

    # --- technician self-service (Slice D backend) ---
    def _org_names(self) -> dict:
        return {str(o.get("id")): o.get("display_name") for o in getattr(self, "_organizations", {}).values()}

    def _activation_exclusive_conflict(self, tid: str, target_org: str, target_exclusivity: str) -> bool:
        """Activation rule: a technician with an active EXCLUSIVE affiliation elsewhere
        gets no new active affiliation, and an exclusive affiliation cannot activate
        while any other active affiliation exists."""
        actives = [
            a for a in getattr(self, "_affiliations", [])
            if str(a.get("technician_id")) == str(tid) and a.get("status") == "active"
            and a.get("ended_at") is None and str(a.get("organization_id")) != str(target_org)
        ]
        if any(a.get("exclusivity") == "exclusive" for a in actives):
            return True
        if target_exclusivity == "exclusive" and actives:
            return True
        return False

    async def list_technician_affiliations(self, technician_id: UUID) -> list[dict]:
        tid = str(technician_id)
        names = self._org_names()
        return [
            {
                "id": a.get("id"), "organization_id": a.get("organization_id"),
                "organization_name": names.get(str(a.get("organization_id"))),
                "status": a.get("status"), "affiliation_type": a.get("affiliation_type"),
                "exclusivity": a.get("exclusivity"), "dispatch_allowed": a.get("dispatch_allowed"),
                "ended_at": a.get("ended_at"),
            }
            for a in getattr(self, "_affiliations", []) if str(a.get("technician_id")) == tid
        ]

    async def list_technician_organizations(self, technician_id: UUID) -> list[dict]:
        tid, names, seen = str(technician_id), self._org_names(), {}
        for a in getattr(self, "_affiliations", []):
            if (str(a.get("technician_id")) == tid and a.get("status") == "active"
                    and a.get("ended_at") is None):
                oid = str(a.get("organization_id"))
                seen[oid] = {"id": oid, "name": names.get(oid)}
        return list(seen.values())

    def _find_self_affiliation(self, affiliation_id: UUID, technician_id: UUID) -> dict | None:
        return next(
            (a for a in getattr(self, "_affiliations", [])
             if str(a.get("id")) == str(affiliation_id)
             and str(a.get("technician_id")) == str(technician_id)),
            None,
        )

    async def accept_affiliation(self, affiliation_id: UUID, technician_id: UUID) -> dict | None:
        aff = self._find_self_affiliation(affiliation_id, technician_id)
        if aff is None:
            return None
        if aff.get("status") != "pending_invite":
            raise ValueError("not_pending")
        if self._activation_exclusive_conflict(
            str(technician_id), aff.get("organization_id"), aff.get("exclusivity")
        ):
            raise ValueError("exclusive_conflict")
        aff["status"] = "active"
        aff["ended_at"] = None
        aff["ended_reason"] = None
        return dict(aff)

    async def decline_affiliation(
        self, affiliation_id: UUID, technician_id: UUID, *, reason: str | None = None
    ) -> dict | None:
        aff = self._find_self_affiliation(affiliation_id, technician_id)
        if aff is None:
            return None
        if aff.get("status") != "pending_invite":
            raise ValueError("not_pending")
        aff["status"] = "rejected"
        aff["ended_at"] = datetime.now(timezone.utc).isoformat()  # close the period → re-invite allowed
        aff["ended_reason"] = reason
        return dict(aff)

    async def set_technician_photo(self, technician_id: UUID, url: str) -> dict | None:
        tid = str(technician_id)
        tech = next((t for t in getattr(self, "_technicians", []) if str(t.get("id")) == tid), None)
        if tech is None:
            return None
        tech["profile_photo_url"] = url
        # Technician self-service photos are auto-approved for now; a real Ops/admin
        # review workflow is deferred (the /admin/technicians/*/photo routes remain).
        tech["profile_photo_status"] = "approved"
        return {"photo_url": url, "photo_status": "approved"}

    async def set_technician_photo_status(self, technician_id: UUID, status: str) -> dict | None:
        tid = str(technician_id)
        tech = next((t for t in getattr(self, "_technicians", []) if str(t.get("id")) == tid), None)
        if tech is None:
            return None
        tech["profile_photo_status"] = status
        return {"id": tid, "photo_status": status, "photo_url": tech.get("profile_photo_url")}

    async def backfill_affiliations_from_primary_org(self) -> int:
        """Active affiliation row for every technician with a primary_organization_id
        but no affiliation row for that org. Idempotent; returns rows inserted."""
        affs = self._affiliations = getattr(self, "_affiliations", [])
        count = 0
        for tech in getattr(self, "_technicians", []):
            org = tech.get("primary_organization_id")
            if not org:
                continue
            oid, tid = str(org), str(tech.get("id"))
            if any(str(a.get("organization_id")) == oid and str(a.get("technician_id")) == tid for a in affs):
                continue
            affs.append({
                "organization_id": oid, "technician_id": tid, "status": "active",
                "affiliation_type": "unknown", "exclusivity": "unknown",
                "dispatch_allowed": True, "ended_at": None, "ended_reason": None,
            })
            count += 1
        return count

    async def get_fleet_state(self, org_id: str | None = None) -> list[dict]:
        return []

    async def list_dispatchable_jobs(
        self, *, max_attempts: int, total_timeout_seconds: int, limit: int = 100
    ) -> list[dict]:
        return []

    async def get_dispatch_status(
        self, ticket_id: UUID, *, max_attempts: int, total_timeout_seconds: int
    ) -> dict | None:
        offers = getattr(self, "_offers", {})
        jid = str(ticket_id)
        active = sum(1 for o in offers.values() if o["job_id"] == jid and o["status"] == "offered")
        total = sum(1 for o in offers.values() if o["job_id"] == jid)
        matched = any(o["job_id"] == jid and o["status"] == "accepted" for o in offers.values())
        attempts = getattr(self, "_attempts", {}).get(jid, 0)
        state = resolve_dispatch_state(
            matched=matched, active_offers=active, total_offers=total,
            attempts=attempts, max_attempts=max_attempts, timed_out=False,
        )
        status = (self._job_status.get(jid) if hasattr(self, "_job_status") else None)
        tech_id = getattr(self, "_job_tech", {}).get(jid)
        loc = getattr(self, "_tech_location", {}).get(str(tech_id)) if tech_id else None
        loc_at = loc[2] if (loc and len(loc) > 2) else None
        show_live = bool(
            may_show_live_tracking(status)
            and loc
            and location_is_fresh(
                loc_at,
                now=datetime.now(tz=timezone.utc),
                threshold_minutes=config.LOCATION_ONLINE_THRESHOLD_MINUTES,
            )
        )
        assignment = None
        if tech_id:
            tech = next((t for t in getattr(self, "_technicians", [])
                         if str(t.get("id")) == str(tech_id)), None)
            # Photo is customer-visible only when approved (else UI shows the fallback).
            photo_url = (tech.get("profile_photo_url")
                         if tech and tech.get("profile_photo_status") == "approved" else None)
            assignment = {
                "customer_owner": None, "fulfillment_type": "independent_technician",
                "provider_company": None,
                "technician_display_name": (tech.get("display_name") if tech else None) or "Technician",
                "technician_photo_url": photo_url,
                "role": "Verified Technician", "rating": None,
                "eta_min": None, "eta_max": None, "eta_is_estimate": True,
                "assigned_at": None, "job_status": status or "assigned",
                "live_lat": loc[0] if show_live else None,
                "live_lng": loc[1] if show_live else None,
                "location_updated_at": (loc[2] if (show_live and len(loc) > 2) else None),
            }
        dest = getattr(self, "_job_loc", {}).get(jid)
        payment = getattr(self, "_payments", {}).get((jid, "technician"))
        closeout = await self.get_job_closeout(UUID(jid))
        # Blind tracking: remove dispatch internals
        return {
            "state": state,
            "terminal": is_terminal(state, attempts=attempts, max_attempts=max_attempts, timed_out=False),
            "status": status,
            "closed": False,
            "customer_actions": customer_actions(status),
            "assignment": assignment,
            "destination": ({"lat": dest[0], "lng": dest[1]} if (may_show_live_tracking(status) and dest) else None),
            "payment": ({"amount": payment["amount"], "currency": payment.get("currency", "USD"), "method": payment["method"]} if payment else None),
            "closeout": closeout,
        }

    # --- fulfillment cutover (Sprint 3) — minimal in-memory backing for tests ---
    async def get_tracking_token(self, job_id: UUID) -> str | None:
        return getattr(self, "_tokens", {}).get(str(job_id))

    async def resolve_tracking_token(self, token: str) -> str | None:
        for jid, tok in getattr(self, "_tokens", {}).items():
            if tok == token:
                return jid
        return None

    async def get_tracking_by_token(
        self, token: str, *, max_attempts: int, total_timeout_seconds: int
    ) -> dict | None:
        job_id = await self.resolve_tracking_token(token)
        if job_id is None:
            return None
        return await self.get_dispatch_status(
            job_id, max_attempts=max_attempts, total_timeout_seconds=total_timeout_seconds
        )

    async def get_job_lifecycle(self, job_id: UUID) -> dict | None:
        jid = str(job_id)
        statuses = getattr(self, "_job_status", {})
        if jid not in statuses:
            return None
        return {
            "status": statuses.get(jid),
            "fulfillment_technician_id": getattr(self, "_job_tech", {}).get(jid),
            "fulfillment_org_id": getattr(self, "_job_fulfillment_org", {}).get(jid),
            "customer_owner_org_id": getattr(self, "_job_org", {}).get(jid),
        }

    async def get_technician_active_job(self, technician_id: UUID) -> dict | None:
        _ACTIVE = {"assigned", "en_route", "arrived", "in_progress", "completed_pending_customer"}
        tid = str(technician_id)
        job_techs = getattr(self, "_job_tech", {})
        statuses = getattr(self, "_job_status", {})
        for jid, tech_id in job_techs.items():
            if tech_id == tid and statuses.get(jid) in _ACTIVE:
                loc = getattr(self, "_job_loc", {}).get(jid)
                tech = next((t for t in getattr(self, "_technicians", []) if str(t.get("id")) == tid), {})
                job_lat = loc[0] if loc else None
                job_lng = loc[1] if loc else None
                tech_lat = tech.get("current_lat")
                tech_lng = tech.get("current_lng")
                dist = haversine_km(job_lat, job_lng, tech_lat, tech_lng)
                dist_km = dist if dist != float("inf") else None
                eta_min, eta_max = eta_range_from_km(dist_km)
                loc_updated = tech.get("location_updated_at")
                return {
                    "id": jid,
                    "status": statuses[jid],
                    "access_type": getattr(self, "_job_access_type", {}).get(jid),
                    "situation": getattr(self, "_job_situation", {}).get(jid),
                    "address": getattr(self, "_job_address", {}).get(jid),
                    "lat": job_lat,
                    "lng": job_lng,
                    "detail": getattr(self, "_job_detail", {}).get(jid, {}),
                    "photo_paths": list(getattr(self, "_job_photo_paths", {}).get(jid, [])),
                    "technician_current_lat": tech_lat,
                    "technician_current_lng": tech_lng,
                    "technician_location_updated_at": loc_updated,
                    "technician_location_is_fresh": location_is_fresh(
                        loc_updated,
                        now=datetime.now(timezone.utc),
                        threshold_minutes=config.LOCATION_ONLINE_THRESHOLD_MINUTES,
                    ),
                    "distance_km": round(dist_km, 2) if dist_km is not None else None,
                    "distance_mi": round(dist_km * 0.621371, 2) if dist_km is not None else None,
                    "eta_min": eta_min,
                    "eta_max": eta_max,
                    "eta_is_estimate": True,
                }
        return None

    async def decline_dispatch_offer(
        self, offer_id: UUID, technician_id: UUID, reason: str | None = None
    ) -> bool:
        offers = getattr(self, "_offers", {})
        offer = offers.get(str(offer_id))
        if offer and offer.get("technician_id") == str(technician_id) and offer.get("status") == "offered":
            offer["status"] = "declined"
            offer["decline_reason"] = reason
            return True
        return False

    async def get_ops_technician(self, technician_id: UUID, org_id: str | None = None) -> dict | None:
        tid = str(technician_id)
        for t in getattr(self, "_technicians", []):
            if str(t.get("id")) == tid and t.get("status") == "active" and t.get("vetting_status") == "verified":
                if org_id is not None and not self._tech_eligible_for_org(t, org_id):
                    return None
                return t
        return None

    async def create_arrival_pin(
        self, job_id: UUID, technician_id: UUID, pin_hash: str,
        expires_at: datetime, max_attempts: int,
    ) -> None:
        pins = getattr(self, "_arrival_pins", None)
        if pins is None:
            pins = self._arrival_pins = {}
        pins[str(job_id)] = {
            "technician_id": str(technician_id),
            "pin_hash": pin_hash,
            "expires_at": expires_at,
            "attempts": 0,
            "max_attempts": max_attempts,
            "verified_at": None,
        }

    async def verify_arrival_pin(
        self, job_id: UUID, technician_id: UUID, pin_hash: str
    ) -> dict:
        rec = getattr(self, "_arrival_pins", {}).get(str(job_id))
        if rec is None:
            return {"ok": False, "reason": "no_pin", "remaining": 0}
        if rec["verified_at"] is not None:
            return {"ok": False, "reason": "already_used", "remaining": 0}
        remaining = rec["max_attempts"] - rec["attempts"]
        if rec["technician_id"] != str(technician_id):
            return {"ok": False, "reason": "technician_mismatch", "remaining": remaining}
        if rec["attempts"] >= rec["max_attempts"]:
            return {"ok": False, "reason": "locked", "remaining": 0}
        if datetime.now(timezone.utc) > rec["expires_at"]:
            return {"ok": False, "reason": "expired", "remaining": remaining}
        if rec["pin_hash"] == pin_hash:
            rec["verified_at"] = datetime.now(timezone.utc)
            return {"ok": True, "reason": None, "remaining": remaining}
        rec["attempts"] += 1
        remaining = max(0, rec["max_attempts"] - rec["attempts"])
        return {"ok": False, "reason": "locked" if remaining == 0 else "incorrect", "remaining": remaining}

    async def get_provider_active_jobs(self, org_id: str) -> list[dict]:
        statuses = getattr(self, "_job_status", {})
        job_org = getattr(self, "_job_org", {})
        job_tech = getattr(self, "_job_tech", {})
        job_loc = getattr(self, "_job_loc", {})
        job_timestamps = getattr(self, "_job_timestamps", {})
        offers = getattr(self, "_offers", {})
        recoverable = {
            STATUS_PENDING_DISPATCH, STATUS_ASSIGNED, STATUS_EN_ROUTE, STATUS_ARRIVED,
            STATUS_IN_PROGRESS, STATUS_COMPLETED_PENDING, STATUS_DISPUTED,
        }
        out = []
        for jid, status in statuses.items():
            if status not in recoverable or job_org.get(jid) != str(org_id):
                continue
            active_offer = next(
                (o for o in offers.values() if o.get("job_id") == jid and o.get("status") == "offered"),
                None,
            )
            issues = [e for e in self._events_for(jid) if e["event"].startswith("tech_issue:")]
            tech_id = job_tech.get(jid)
            tech = next((t for t in getattr(self, "_technicians", []) if str(t.get("id")) == str(tech_id)), None)
            loc = job_loc.get(jid)
            timestamps = job_timestamps.get(jid, {})
            out.append({
                "id": jid, "status": status,
                "address": getattr(self, "_job_address", {}).get(jid),
                "access_type": getattr(self, "_job_access_type", {}).get(jid),
                "situation": getattr(self, "_job_situation", {}).get(jid),
                "urgency": getattr(self, "_job_urgency", {}).get(jid),
                "created_at": getattr(self, "_job_created_at", {}).get(jid),
                "lat": loc[0] if loc else None,
                "lng": loc[1] if loc else None,
                "fulfillment_technician_id": tech_id,
                "technician_display_name": tech.get("display_name") if tech else None,
                "technician_location_updated_at": tech.get("location_updated_at") if tech else None,
                "active_status_started_at": _active_status_started_at(status, timestamps),
                "offer_active": active_offer is not None,
                "offer_id": active_offer["id"] if active_offer else None,
                "offer_expires_at": active_offer.get("expires_at") if active_offer else None,
                "last_issue": issues[-1]["event"] if issues else None,
            })
        return out

    def _events_for(self, jid: str) -> list[dict]:
        """Parse the flat in-memory event log into {at, event} for one job."""
        out = []
        for line in getattr(self, "events", []):
            parts = line.split(" ", 2)
            if len(parts) == 3 and parts[1] == jid:
                out.append({"at": parts[0], "event": parts[2]})
        return out

    async def list_job_events(self, job_id: UUID) -> list[dict]:
        return self._events_for(str(job_id))

    async def list_org_events(self, org_id: str, *, limit: int = 200) -> list[dict]:
        job_org = getattr(self, "_job_org", {})
        fulfillment_org = getattr(self, "_job_fulfillment_org", {})
        addresses = getattr(self, "_job_address", {})
        out = []
        for idx, line in enumerate(getattr(self, "events", [])):
            parts = line.split(" ", 2)
            if len(parts) != 3:
                continue
            at, jid, event = parts
            if job_org.get(jid) != str(org_id) and fulfillment_org.get(jid) != str(org_id):
                continue
            # Keep the append index as a tiebreaker so equal/coarse timestamps fall
            # back to insertion order — matching the DB's `order by at desc, id desc`.
            out.append((at or "", idx, {"job_id": jid, "event": event, "at": at, "address": addresses.get(jid)}))
        out.sort(key=lambda e: (e[0], e[1]), reverse=True)
        return [e[2] for e in out][:limit]

    async def recover_job(
        self, job_id: UUID, *, target_status: str, expected_statuses: list[str],
        clear_technician: bool = False, reason: str | None = None, audit_label: str = "recover",
    ) -> dict | None:
        self._job_status = getattr(self, "_job_status", {})
        jid = str(job_id)
        if self._job_status.get(jid) not in expected_statuses:
            return None
        self._job_status[jid] = target_status
        self._stamp_job_timestamps(jid, {"cancelled_at"} if target_status == STATUS_CANCELLED else set())
        if clear_technician:
            getattr(self, "_job_tech", {}).pop(jid, None)
        for o in getattr(self, "_offers", {}).values():
            if o.get("job_id") == jid and o.get("status") == "offered":
                o["status"] = "superseded"
        await self.log_event_raw(job_id, f"{audit_label}:{(reason or '')[:200]}")
        return {"id": jid, "status": target_status}

    async def add_job_note(
        self, job_id: UUID, *, author_id: str, author_name: str | None, body: str
    ) -> dict:
        notes = getattr(self, "_job_notes", None)
        if notes is None:
            notes = self._job_notes = {}
        rec = {
            "id": str(uuid4()), "job_id": str(job_id), "author_id": author_id,
            "author_name": author_name, "body": body,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        notes.setdefault(str(job_id), []).append(rec)
        return rec

    async def list_job_notes(self, job_id: UUID) -> list[dict]:
        return list(getattr(self, "_job_notes", {}).get(str(job_id), []))

    async def ops_create_single_offer(
        self, job_id: UUID, technician_id: UUID, org_id: UUID | None, expires_at: datetime
    ) -> dict | None:
        offers = getattr(self, "_offers", None)
        if offers is None:
            offers = self._offers = {}
        jid = str(job_id)
        # Atomic guard: job must still be pending_dispatch (not cancelled/assigned)
        statuses = getattr(self, "_job_status", {})
        if statuses.get(jid) != STATUS_PENDING_DISPATCH:
            return {"error_code": "job_not_pending"}
        if any(o.get("status") == "offered" and o.get("job_id") == jid for o in offers.values()):
            return {"error_code": "concurrent_offer"}
        rec = {
            "id": str(uuid4()),
            "job_id": jid,
            "technician_id": str(technician_id),
            "organization_id": str(org_id) if org_id else None,
            "rank": 0,
            "status": "offered",
        }
        offers[rec["id"]] = rec
        return rec

    def _stamp_job_timestamps(self, jid: str, columns: set[str]) -> None:
        """Coalesce-set lifecycle timestamp columns (first write wins, mirroring
        Postgres's `coalesce(col, now())`) and always bump updated_at (mirroring
        Postgres's unconditional `updated_at = now()`). Backs get_provider_job_
        history's finished_at, which reads these the same way the Postgres
        history query reads its real columns."""
        timestamps = getattr(self, "_job_timestamps", None)
        if timestamps is None:
            timestamps = self._job_timestamps = {}
        now = datetime.now(timezone.utc).isoformat()
        record = timestamps.setdefault(jid, {})
        for col in columns:
            record.setdefault(col, now)
        record["updated_at"] = now

    async def set_job_status(
        self,
        job_id: UUID,
        new_status: str,
        *,
        expected_current: str | None = None,
        extra_timestamps: list[str] | None = None,
    ) -> dict | None:
        self._job_status = getattr(self, "_job_status", {})
        jid = str(job_id)
        if expected_current is not None and self._job_status.get(jid) != expected_current:
            return None
        self._job_status[jid] = new_status
        cols = set(extra_timestamps or [])
        ts_col = STATUS_TIMESTAMP_COLUMN.get(new_status)
        if ts_col:
            cols.add(ts_col)
        self._stamp_job_timestamps(jid, cols)
        return {"id": jid, "status": new_status}

    async def cancel_job(
        self, job_id: UUID, *, current_status: str, reason: str | None = None
    ) -> dict | None:
        self._job_status = getattr(self, "_job_status", {})
        jid = str(job_id)
        if self._job_status.get(jid) != current_status:
            return None
        self._job_status[jid] = STATUS_CANCELLED
        self._stamp_job_timestamps(jid, {"cancelled_at", "closed_at"})
        for o in getattr(self, "_offers", {}).values():
            if o.get("job_id") == jid and o.get("status") == "offered":
                o["status"] = "superseded"
        await self.log_event_raw(
            job_id, f"customer_cancel:{reason[:200]}" if reason else "customer_cancel"
        )
        return {"id": jid, "status": STATUS_CANCELLED}

    async def record_customer_review(
        self, *, job_id: UUID, rating: int, comment: str | None,
        issue_reported: bool = False, imply_confirm: bool = False,
    ) -> dict:
        review = {
            "id": str(uuid4()), "ticket_id": str(job_id), "rating": rating,
            "comment": comment, "issue_reported": issue_reported,
        }
        self.reviews.append(review)
        return review

    async def record_payment_report(
        self, *, job_id: UUID, reported_by: str, amount: float, method: str,
        currency: str = "USD",
    ) -> dict:
        payments = getattr(self, "_payments", None)
        if payments is None:
            payments = self._payments = {}
        rec = {
            "job_id": str(job_id), "reported_by": reported_by,
            "amount": round(float(amount), 2), "currency": currency, "method": method,
            "reported_at": datetime.now(timezone.utc).isoformat(),
        }
        payments[(str(job_id), reported_by)] = rec
        return rec

    async def record_job_closeout(self, closeout: dict) -> dict:
        jid = str(closeout["job_id"])
        now = datetime.now(timezone.utc).isoformat()
        rec = {
            **closeout,
            "job_id": jid,
            "reported_at": now,
            "updated_at": now,
            "line_items": [dict(item) for item in closeout.get("line_items", [])],
        }
        self._job_closeouts[jid] = rec
        return dict(rec)

    async def get_job_closeout(self, job_id: UUID) -> dict | None:
        rec = self._job_closeouts.get(str(job_id))
        if rec is None:
            return None
        return {**rec, "line_items": [dict(item) for item in rec.get("line_items", [])]}

    async def get_payment_reports(self, job_id: UUID) -> dict:
        payments = getattr(self, "_payments", {})
        return {
            "technician": payments.get((str(job_id), "technician")),
            "customer": payments.get((str(job_id), "customer")),
        }

    async def get_job_review(self, job_id: UUID) -> dict | None:
        jid = str(job_id)
        for review in reversed(getattr(self, "reviews", [])):
            if review.get("ticket_id") == jid:
                return review
        return None

    def _resolve_job_finished_at(self, jid: str, closeout: dict | None) -> str | None:
        """Mirrors the Postgres history query's
        coalesce(confirmed_at, closed_at, cancelled_at, disputed_at, updated_at).
        A job that transitioned through set_job_status/cancel_job/recover_job has
        real tracked timestamps; a job whose status was set by directly poking
        _job_status (bypassing the store API -- historically how this test suite
        seeded jobs) has none, so fall back to the closeout's reported_at: a real
        timestamp of when the closeout was recorded, not a fabricated date."""
        record = getattr(self, "_job_timestamps", {}).get(jid)
        if record:
            for col in ("confirmed_at", "closed_at", "cancelled_at", "disputed_at", "updated_at"):
                if record.get(col):
                    return record[col]
        return (closeout or {}).get("reported_at")

    async def get_provider_job_history(self, org_id: str, *, limit: int = 100, offset: int = 0) -> list[dict]:
        statuses = getattr(self, "_job_status", {})
        out = []
        for jid, status in statuses.items():
            if status not in HISTORY_STATUSES:
                continue
            if org_id is not None and str(getattr(self, "_job_org", {}).get(jid)) != str(org_id):
                continue
            closeout = await self.get_job_closeout(UUID(jid))
            out.append({
                "id": jid, "status": status,
                "fulfillment_technician_id": getattr(self, "_job_tech", {}).get(jid),
                "technician_display_name": None,
                "access_type": getattr(self, "_job_access_type", {}).get(jid),
                "review": await self.get_job_review(UUID(jid)),
                "payments": await self.get_payment_reports(UUID(jid)),
                "closeout": closeout,
                "finished_at": self._resolve_job_finished_at(jid, closeout),
            })
        return out[offset:offset + limit]

    async def _all_provider_job_history(self, org_id: str) -> list[dict]:
        """Every job in the org's history, unbounded (a dict scan -- no page cap to fall afoul of)."""
        return await self.get_provider_job_history(org_id, limit=len(getattr(self, "_job_status", {})) + 1)

    async def _all_settlement_payments(self, org_id: str) -> list[dict]:
        return await self.list_settlement_payments(org_id, limit=len(getattr(self, "_settlement_payments", {})) + 1)

    async def _all_settlement_periods(self, org_id: str) -> list[dict]:
        return await self.list_provider_settlement_periods(org_id, limit=len(getattr(self, "_settlement_periods", {})) + 1)

    async def _settlement_rows_from_history(self, org_id: str, job_rows: list[dict]) -> list[dict]:
        """Job-history rows -> settlement rows (agreement-applied, affiliation-stamped),
        with no period/technician filtering. Shared by list_provider_settlements (which
        filters afterward) and the financial overview (which needs the unfiltered set)."""
        agreements: dict[str, tuple[dict | None, bool, str | None]] = {}
        out = []
        for row in job_rows:
            tech_id = row.get("fulfillment_technician_id")
            closeout = row.get("closeout")
            if not tech_id or not closeout:
                continue
            key = str(tech_id)
            if key not in agreements:
                agreements[key] = await self.get_provider_technician_agreement_for_reporting(
                    UUID(str(org_id)), UUID(key)
                )
            agreement, affiliation_ended, affiliation_ended_at = agreements[key]
            settlement = calculate_settlement(row, agreement)
            settlement["affiliation_ended"] = affiliation_ended
            settlement["affiliation_ended_at"] = affiliation_ended_at
            out.append(settlement)
        return out

    async def list_provider_settlements(
        self, org_id: str, *, technician_id: str | None = None,
        period_start: str | None = None, period_end: str | None = None,
        limit: int = 100,
    ) -> list[dict]:
        rows = await self.get_provider_job_history(org_id, limit=limit)
        settlements = await self._settlement_rows_from_history(org_id, rows)
        filters = {"technician_id": technician_id, "period_start": period_start, "period_end": period_end}
        return [s for s in settlements if _settlement_row_in_period(s, filters)]

    async def get_provider_financial_overview(
        self, org_id: str, *, period_start: str | None = None, period_end: str | None = None
    ) -> dict:
        job_rows = await self._all_provider_job_history(org_id)
        all_time_rows = await self._settlement_rows_from_history(org_id, job_rows)
        period_filter = {"technician_id": None, "period_start": period_start, "period_end": period_end}
        period_rows = [r for r in all_time_rows if _settlement_row_in_period(r, period_filter)]
        payments = await self._all_settlement_payments(org_id)
        periods = await self._all_settlement_periods(org_id)
        skill_labels = await _skill_label_map(self)
        item_labels = await _item_type_label_map(self)
        return build_financial_overview(
            all_time_rows, period_rows, payments, periods,
            period_start=period_start, period_end=period_end,
            skill_labels=skill_labels, item_labels=item_labels,
        )

    async def list_technician_settlements(self, technician_id: UUID, *, limit: int = 100) -> dict:
        rows = []
        for row in await self.get_technician_job_history(technician_id, limit=limit):
            org_id = row.get("fulfillment_org_id") or row.get("customer_owner_org_id")
            if not org_id or not row.get("closeout"):
                continue
            agreement = await self.get_provider_technician_agreement(UUID(str(org_id)), technician_id)
            settlement = calculate_settlement(row, agreement)
            settlement["organization_id"] = str(org_id)
            rows.append(settlement)
        period_rows = []
        for period in getattr(self, "_settlement_periods", {}).values():
            for row in period.get("rows", []):
                if str(row.get("technician_id")) == str(technician_id):
                    period_rows.append({
                        "settlement_period_id": period["id"],
                        "status": period["status"],
                        "label": period["label"],
                        "period_start": period.get("period_start"),
                        "period_end": period.get("period_end"),
                        "locked_at": period.get("locked_at"),
                        "paid_at": period.get("paid_at"),
                        "row": dict(row),
                    })
        return {"live": rows, "period_rows": period_rows}

    async def create_provider_settlement_period(
        self, org_id: str, data: dict, *, created_by: str | None = None
    ) -> dict:
        already_settled = {
            row.get("job_id")
            for period in self._settlement_periods.values()
            if str(period.get("organization_id")) == str(org_id)
            for row in period.get("rows", [])
        }
        rows = [
            row for row in await self.list_provider_settlements(org_id, limit=1000)
            if row.get("job_id") not in already_settled and _settlement_row_in_period(row, data)
        ]
        now = datetime.now(timezone.utc).isoformat()
        period_id = str(uuid4())
        period = {
            "id": period_id, "organization_id": str(org_id), "status": "draft",
            "period_start": data.get("period_start"), "period_end": data.get("period_end"),
            "technician_id": data.get("technician_id"),
            "label": data.get("label") or f"Settlement {data.get('period_start') or ''} – {data.get('period_end') or ''}".strip(),
            "created_by": created_by, "created_at": now, "updated_at": now,
            "locked_at": None, "locked_by": None, "paid_at": None, "paid_by": None,
            "note": data.get("note"), "rows": [dict(row) for row in rows], "adjustments": [],
        }
        period.update(_settlement_period_totals(period["rows"], period["adjustments"]))
        self._settlement_periods[period_id] = period
        return dict(period)

    async def list_provider_settlement_periods(self, org_id: str, *, limit: int = 50, offset: int = 0) -> list[dict]:
        rows = [
            {k: v for k, v in period.items() if k not in {"rows", "adjustments"}}
            for period in self._settlement_periods.values()
            if str(period.get("organization_id")) == str(org_id)
        ]
        rows.sort(key=lambda item: item.get("created_at") or "", reverse=True)
        return rows[offset:offset + limit]

    async def get_provider_settlement_period(self, org_id: str, period_id: UUID) -> dict | None:
        period = self._settlement_periods.get(str(period_id))
        if period is None or str(period.get("organization_id")) != str(org_id):
            return None
        period.update(_settlement_period_totals(period.get("rows", []), period.get("adjustments", [])))
        return {**period, "rows": [dict(row) for row in period.get("rows", [])], "adjustments": [dict(a) for a in period.get("adjustments", [])]}

    async def lock_provider_settlement_period(self, org_id: str, period_id: UUID, *, actor_id: str | None = None, note: str | None = None) -> dict | None:
        period = await self.get_provider_settlement_period(org_id, period_id)
        if period is None:
            return None
        if period["status"] != "draft":
            raise ValueError("invalid_status")
        period["status"] = "locked"; period["locked_at"] = datetime.now(timezone.utc).isoformat()
        period["locked_by"] = actor_id; period["note"] = note or period.get("note"); period["updated_at"] = period["locked_at"]
        self._settlement_periods[str(period_id)] = period
        return await self.get_provider_settlement_period(org_id, period_id)

    async def mark_provider_settlement_period_paid(self, org_id: str, period_id: UUID, *, actor_id: str | None = None, note: str | None = None) -> dict | None:
        period = await self.get_provider_settlement_period(org_id, period_id)
        if period is None:
            return None
        if period["status"] != "locked":
            raise ValueError("invalid_status")
        period["status"] = "paid"; period["paid_at"] = datetime.now(timezone.utc).isoformat()
        period["paid_by"] = actor_id; period["note"] = note or period.get("note"); period["updated_at"] = period["paid_at"]
        self._settlement_periods[str(period_id)] = period
        return await self.get_provider_settlement_period(org_id, period_id)

    async def add_provider_settlement_adjustment(self, org_id: str, period_id: UUID, data: dict, *, actor_id: str | None = None) -> dict | None:
        period = await self.get_provider_settlement_period(org_id, period_id)
        if period is None:
            return None
        if period["status"] != "draft":
            raise ValueError("invalid_status")
        period.setdefault("adjustments", []).append({
            "id": str(uuid4()), "amount_cents": int(data.get("amount_cents") or 0),
            "reason": data.get("reason"), "created_by": actor_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        period.update(_settlement_period_totals(period.get("rows", []), period.get("adjustments", [])))
        self._settlement_periods[str(period_id)] = period
        return await self.get_provider_settlement_period(org_id, period_id)

    def _technician_name(self, technician_id: str | None) -> str | None:
        tech = next((t for t in getattr(self, "_technicians", [])
                     if str(t.get("id")) == str(technician_id)), None)
        return tech.get("display_name") if tech else None

    async def create_settlement_payment(
        self, org_id: str, data: dict, *, submitted_by: str | None,
        submitted_by_role: str, status: str,
    ) -> dict:
        now = datetime.now(timezone.utc).isoformat()
        payment = {
            "id": str(uuid4()),
            "organization_id": str(org_id),
            "technician_id": str(data["technician_id"]),
            "technician_display_name": self._technician_name(data.get("technician_id")),
            "settlement_period_id": data.get("settlement_period_id"),
            "source_period_start": data.get("source_period_start"),
            "source_period_end": data.get("source_period_end"),
            "direction": data["direction"],
            "amount_cents": int(data["amount_cents"]),
            "payment_method": data["payment_method"],
            "reference_number": data.get("reference_number"),
            "paid_on": data["paid_on"],
            "note": data.get("note"),
            "status": status,
            "submitted_by_role": submitted_by_role,
            "submitted_by": submitted_by,
            "confirmed_by": submitted_by if status == "confirmed" else None,
            "confirmed_at": now if status == "confirmed" else None,
            "rejected_by": None, "rejected_at": None, "rejected_reason": None,
            "voided_by": None, "voided_at": None, "void_reason": None,
            "created_at": now, "updated_at": now,
        }
        payments = getattr(self, "_settlement_payments", None)
        if payments is None:
            payments = self._settlement_payments = {}
        payments[payment["id"]] = payment
        return dict(payment)

    async def list_settlement_payments(
        self, org_id: str, *, technician_id: str | None = None,
        status: str | None = None, period_start: str | None = None,
        period_end: str | None = None, limit: int = 500, offset: int = 0,
    ) -> list[dict]:
        filters = {
            "technician_id": technician_id, "status": status,
            "period_start": period_start, "period_end": period_end,
        }
        rows = [
            dict(p) for p in getattr(self, "_settlement_payments", {}).values()
            if str(p.get("organization_id")) == str(org_id)
            and _settlement_payment_in_filters(p, filters)
        ]
        rows.sort(key=lambda p: (p.get("paid_on") or "", p.get("created_at") or ""), reverse=True)
        return rows[offset:offset + limit]

    def _own_settlement_payment(self, org_id: str, payment_id: UUID) -> dict | None:
        payment = getattr(self, "_settlement_payments", {}).get(str(payment_id))
        if payment is None or str(payment.get("organization_id")) != str(org_id):
            return None
        return payment

    async def confirm_settlement_payment(
        self, org_id: str, payment_id: UUID, *, actor_id: str | None = None
    ) -> dict | None:
        payment = self._own_settlement_payment(org_id, payment_id)
        if payment is None:
            return None
        if payment["status"] != "pending":
            raise ValueError("invalid_status")
        now = datetime.now(timezone.utc).isoformat()
        payment.update({"status": "confirmed", "confirmed_by": actor_id, "confirmed_at": now, "updated_at": now})
        return dict(payment)

    async def reject_settlement_payment(
        self, org_id: str, payment_id: UUID, *, actor_id: str | None = None, reason: str
    ) -> dict | None:
        payment = self._own_settlement_payment(org_id, payment_id)
        if payment is None:
            return None
        if payment["status"] != "pending":
            raise ValueError("invalid_status")
        now = datetime.now(timezone.utc).isoformat()
        payment.update({"status": "rejected", "rejected_by": actor_id, "rejected_at": now, "rejected_reason": reason, "updated_at": now})
        return dict(payment)

    async def void_settlement_payment(
        self, org_id: str, payment_id: UUID, *, actor_id: str | None = None, reason: str
    ) -> dict | None:
        payment = self._own_settlement_payment(org_id, payment_id)
        if payment is None:
            return None
        if payment["status"] != "confirmed":
            raise ValueError("invalid_status")
        now = datetime.now(timezone.utc).isoformat()
        payment.update({"status": "voided", "voided_by": actor_id, "voided_at": now, "void_reason": reason, "updated_at": now})
        return dict(payment)

    async def list_technician_settlement_payments(
        self, technician_id: UUID, *, limit: int = 200
    ) -> list[dict]:
        rows = [
            {**p, "organization_name": None}
            for p in getattr(self, "_settlement_payments", {}).values()
            if str(p.get("technician_id")) == str(technician_id)
        ]
        rows.sort(key=lambda p: (p.get("paid_on") or "", p.get("created_at") or ""), reverse=True)
        return rows[:limit]

    async def get_technician_job_history(
        self, technician_id: UUID, *, limit: int = 100
    ) -> list[dict]:
        tid = str(technician_id)
        statuses = getattr(self, "_job_status", {})
        out = []
        for jid, status in statuses.items():
            if status not in TECHNICIAN_HISTORY_STATUSES:
                continue
            if str(getattr(self, "_job_tech", {}).get(jid)) != tid:
                continue
            out.append({
                "id": jid, "status": status,
                "review": await self.get_job_review(UUID(jid)),
                "payments": await self.get_payment_reports(UUID(jid)),
                "closeout": await self.get_job_closeout(UUID(jid)),
                "fulfillment_org_id": getattr(self, "_job_fulfillment_org", {}).get(jid),
                "customer_owner_org_id": getattr(self, "_job_org", {}).get(jid),
                "fulfillment_technician_id": tid,
            })
        return out[:limit]

    async def auto_close_pending(self, window_seconds: int) -> int:
        return 0

    async def resolve_job(
        self, job_id: UUID, *, action: str, note: str | None = None
    ) -> dict | None:
        return {"id": str(job_id), "action": action}

    async def log_event_raw(self, job_id: UUID, event: str) -> None:
        self.events.append(f"{datetime.now(timezone.utc).isoformat()} {job_id} {event}")

    async def register_technician(self, data: dict) -> dict:
        raise NotImplementedError("registration requires the Postgres store")

    async def register_organization(self, data: dict) -> dict:
        raise NotImplementedError("registration requires the Postgres store")

    # --- console: platform-wide directories are Postgres-only (no org entity here) ---
    async def list_organizations(self, status: str | None = None) -> list[dict]:
        return []

    async def get_organization_admin_detail(self, organization_id: UUID) -> dict | None:
        return None

    async def list_technicians_admin(self, status: str | None = None) -> list[dict]:
        return []

    async def get_technician_admin_detail(self, technician_id: UUID) -> dict | None:
        return None

    async def list_company_users_admin(self, organization_id: UUID | None = None) -> list[dict]:
        return []

    async def list_platform_admins(self) -> list[dict]:
        return []

    async def get_user_admin_detail(self, user_id: UUID) -> dict | None:
        return None

    async def set_user_account_status(self, user_id: UUID, status: str) -> dict | None:
        return None

    async def update_organization_member_role(
        self, user_id: UUID, organization_id: UUID, role: str
    ) -> dict | None:
        return None

    async def delete_or_archive_user(self, user_id: UUID, *, reason: str) -> dict | None:
        return None

    async def create_platform_admin(self, data: dict) -> dict:
        raise NotImplementedError("platform admin creation requires the Postgres store")

    async def count_active_platform_admins(self) -> int:
        return 0

    # --- console/provider: org membership + tenant-limit enforcement ---
    async def list_organization_members(self, organization_id: UUID) -> list[dict]:
        oid = str(organization_id)
        return [
            {
                "id": u["id"], "display_name": u.get("display_name"),
                "email": u.get("email"), "phone": u.get("phone"),
                "role": (u.get("roles") or [None])[0],
            }
            for u in self.users.values()
            if str(u.get("active_organization_id")) == oid
        ]

    async def count_organization_members(self, organization_id: UUID) -> int:
        return len(await self.list_organization_members(organization_id))

    async def create_organization_member(
        self, organization_id: UUID, data: dict, *, role: str
    ) -> dict:
        email = (data.get("email") or "").strip() or None
        phone = (data.get("phone") or "").strip() or None
        if email and any(str(u.get("email") or "").lower() == email.lower() for u in self.users.values()):
            raise ValueError("email_taken")
        if phone and any(str(u.get("phone") or "") == phone for u in self.users.values()):
            raise ValueError("phone_taken")
        uid = str(uuid4())
        self.users[uid] = {
            "id": uid, "email": email, "phone": phone,
            "display_name": data["display_name"],
            "password_hash": hash_password(data["password"]),
            "roles": [role], "active_organization_id": str(organization_id),
            "organization_name": None,
        }
        return {"id": uid, "display_name": data["display_name"], "email": email, "phone": phone, "role": role}

    async def count_organization_technician_slots(self, organization_id: UUID) -> int:
        oid = str(organization_id)
        open_affiliations = sum(
            1 for a in getattr(self, "_affiliations", [])
            if str(a.get("organization_id")) == oid and a.get("ended_at") is None
        )
        pending_invites = sum(
            1 for inv in getattr(self, "_invites", [])
            if str(inv.get("organization_id")) == oid and inv.get("status") == "pending"
        )
        return open_affiliations + pending_invites

    async def approve_technician(self, technician_id: UUID) -> dict | None:
        return None

    async def set_technician_status(self, technician_id: UUID, status: str) -> dict | None:
        tid = str(technician_id)
        technician = next((item for item in getattr(self, "_technicians", []) if str(item.get("id")) == tid), None)
        if technician is None:
            return None
        technician["status"] = status
        if status == "suspended":
            technician["is_available"] = False
        if status == "active" and technician.get("vetting_status") == "rejected":
            technician["vetting_status"] = "verified"
        return {
            "id": tid,
            "display_name": technician.get("display_name"),
            "status": technician.get("status"),
            "vetting_status": technician.get("vetting_status"),
        }

    async def approve_organization(self, organization_id: UUID) -> dict | None:
        return None

    async def set_organization_status(self, organization_id: UUID, status: str) -> dict | None:
        return None

    async def delete_or_archive_organization(self, organization_id: UUID, *, reason: str) -> dict | None:
        return None

    async def reject_technician(self, technician_id: UUID) -> dict | None:
        return None

    async def reject_organization(self, organization_id: UUID) -> dict | None:
        return None

    async def delete_or_archive_technician(self, technician_id: UUID, *, reason: str) -> dict | None:
        tid = str(technician_id)
        techs = getattr(self, "_technicians", [])
        technician = next((item for item in techs if str(item.get("id")) == tid), None)
        if technician is None:
            return None
        refs = sum(1 for item in getattr(self, "_affiliations", []) if str(item.get("technician_id")) == tid)
        refs += sum(1 for item in getattr(self, "technician_documents", []) if str(item.get("technician_id")) == tid)
        if refs == 0:
            self._technicians = [item for item in techs if str(item.get("id")) != tid]
            return {"id": tid, "action": "deleted", "reason": reason}
        technician["status"] = "archived"
        technician["is_available"] = False
        return {"id": tid, "action": "archived", "status": "archived", "references": refs, "reason": reason}

    async def record_governance_event(
        self,
        *,
        entity_type: str,
        entity_id: UUID,
        action: str,
        reason: str | None = None,
        actor_id: UUID | str | None = None,
        metadata: dict | None = None,
    ) -> dict:
        event = {
            "id": str(uuid4()),
            "entity_type": entity_type,
            "entity_id": str(entity_id),
            "action": action,
            "reason": reason,
            "actor_id": str(actor_id) if actor_id else None,
            "metadata": metadata or {},
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        self.governance_events.append(event)
        return event

    async def list_governance_events(
        self, entity_type: str, entity_id: UUID, *, limit: int = 50
    ) -> list[dict]:
        eid = str(entity_id)
        events = [
            event for event in self.governance_events
            if event["entity_type"] == entity_type and event["entity_id"] == eid
        ]
        return list(reversed(events))[:limit]

    async def update_user_locale(self, user_id: str, locale: str) -> None:
        return None

    async def update_user_profile(self, user_id: str, data: dict) -> dict | None | str:
        user = self.users.get(user_id)
        if user is None:
            return None
        email = data.get("email")
        phone = data.get("phone")
        if email is not None:
            normalized = email.strip().lower()
            for uid, other in self.users.items():
                if uid != user_id and (other.get("email") or "").strip().lower() == normalized:
                    return "email_taken"
        if phone is not None:
            for uid, other in self.users.items():
                if uid != user_id and (other.get("phone") or "").strip() == phone.strip():
                    return "phone_taken"
        if data.get("display_name") is not None:
            user["display_name"] = data["display_name"]
        if email is not None:
            user["email"] = email
        if phone is not None:
            user["phone"] = phone
        return {
            "id": user_id, "display_name": user.get("display_name"),
            "email": user.get("email"), "phone": user.get("phone"),
        }

    async def change_user_password(self, user_id: str, current_password: str, new_password: str) -> bool:
        user = self.users.get(user_id)
        if user is None or not verify_password(current_password, user.get("password_hash")):
            return False
        user["password_hash"] = hash_password(new_password)
        return True

    async def update_technician_profile(self, technician_id: UUID, data: dict) -> dict | None:
        tid = str(technician_id)
        technician = next((item for item in getattr(self, "_technicians", []) if item.get("id") == tid), None)
        if technician is None:
            return None
        technician.update(data)
        user = self.users.get(tid)
        if user:
            if data.get("display_name"):
                user["display_name"] = data["display_name"]
            if data.get("phone"):
                user["phone"] = data["phone"]
        return {"id": tid, **data}

    async def list_technician_documents(self, technician_id: UUID) -> list[dict]:
        docs = [
            d for d in self.technician_documents
            if str(d["technician_id"]) == str(technician_id)
        ]
        return sorted(docs, key=lambda x: x["uploaded_at"], reverse=True)

    async def create_technician_document(
        self, technician_id: UUID, data: dict
    ) -> dict:
        doc_id = str(uuid4())
        doc = {
            "id": doc_id,
            "technician_id": str(technician_id),
            "document_type": data["document_type"],
            "document_number": data.get("document_number"),
            "storage_bucket": data.get("storage_bucket", "private-technician-docs"),
            "storage_path": data.get("storage_path"),
            "status": "pending_review",
            "rejected_reason": None,
            "expiration_date": data.get("expiration_date"),
            "uploaded_at": datetime.now(timezone.utc).isoformat(),
            "reviewed_at": None,
        }
        self.technician_documents.append(doc)
        return doc

    async def review_technician_document(
        self, document_id: UUID, *, status: str, reviewer_id: UUID | None, reason: str | None = None
    ) -> dict | None:
        for doc in self.technician_documents:
            if str(doc["id"]) == str(document_id):
                doc["status"] = status
                doc["rejected_reason"] = reason
                doc["reviewed_at"] = datetime.now(timezone.utc).isoformat()
                return doc
        return None

    async def get_technician_document(self, document_id: UUID, technician_id: UUID) -> dict | None:
        for doc in self.technician_documents:
            if str(doc["id"]) == str(document_id) and str(doc["technician_id"]) == str(technician_id):
                return dict(doc)
        return None

    async def list_pending_technician_documents(self) -> list[dict]:
        return [dict(d) for d in self.technician_documents if d.get("status") == "pending_review"]

    async def get_technician_document_admin(self, document_id: UUID) -> dict | None:
        for doc in self.technician_documents:
            if str(doc["id"]) == str(document_id):
                return dict(doc)
        return None

    async def list_technician_offers(self, technician_id: UUID) -> list[dict]:
        return []

    async def get_global_setting(self, key: str) -> dict | None:
        row = self._global_settings.get(key)
        return dict(row) if row is not None else None

    async def list_global_settings(self) -> list[dict]:
        return [dict(v) for v in self._global_settings.values()]

    async def upsert_global_setting(
        self, key: str, value: object, value_type: str, updated_by: str | None = None
    ) -> dict:
        existing = self._global_settings.get(key, {})
        row = {
            "key": key,
            "value": value,
            "value_type": value_type,
            "description": existing.get("description"),
            "is_secret": False,
            "is_runtime_editable": existing.get("is_runtime_editable", True),
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "updated_by": updated_by,
        }
        self._global_settings[key] = row
        return dict(row)

    async def list_service_catalog(self, active_only: bool = False) -> list[dict]:
        categories = sorted(self._service_categories.values(), key=lambda c: (c.get("sort_order", 100), c["code"]))
        result: list[dict] = []
        for category in categories:
            if active_only and category.get("status") != "active":
                continue
            skills = [
                dict(skill)
                for skill in sorted(self._service_skills.values(), key=lambda s: (s.get("sort_order", 100), s["code"]))
                if skill.get("category_code") == category["code"]
                and (not active_only or skill.get("status") == "active")
            ]
            result.append({**category, "skills": skills})
        return result

    async def upsert_service_category(self, data: dict, updated_by: str | None = None) -> dict:
        row = {
            **data,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "updated_by": updated_by,
        }
        self._service_categories[data["code"]] = row
        return {**row, "skills": [s for s in self._service_skills.values() if s.get("category_code") == data["code"]]}

    async def upsert_service_skill(self, data: dict, updated_by: str | None = None) -> dict:
        if data["category_code"] not in self._service_categories:
            raise KeyError(data["category_code"])
        row = {
            **data,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "updated_by": updated_by,
        }
        self._service_skills[data["code"]] = row
        return dict(row)

    async def list_closeout_item_types(self, active_only: bool = False) -> list[dict]:
        rows = sorted(self._closeout_item_types.values(), key=lambda r: (r.get("sort_order", 100), r["code"]))
        return [dict(row) for row in rows if not active_only or row.get("status") == "active"]

    async def upsert_closeout_item_type(self, data: dict, updated_by: str | None = None) -> dict:
        row = {
            **data,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "updated_by": updated_by,
        }
        self._closeout_item_types[data["code"]] = row
        return dict(row)

    async def list_organization_capabilities(self, organization_id: str) -> list[str]:
        return sorted(self._organization_capabilities.get(str(organization_id), set()))

    async def replace_organization_capabilities(
        self, organization_id: str, skill_codes: list[str], updated_by: str | None = None
    ) -> list[str]:
        self._organization_capabilities[str(organization_id)] = set(skill_codes)
        return await self.list_organization_capabilities(organization_id)

    async def get_organization_setting(self, organization_id: str, key: str) -> dict | None:
        row = self._organization_settings.get((str(organization_id), key))
        return dict(row) if row is not None else None

    async def upsert_organization_setting(
        self, organization_id: str, key: str, value: object, value_type: str, updated_by: str | None = None
    ) -> dict:
        row = {
            "organization_id": str(organization_id),
            "key": key,
            "value": value,
            "value_type": value_type,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "updated_by": updated_by,
        }
        self._organization_settings[(str(organization_id), key)] = row
        return dict(row)

    async def delete_organization_setting(self, organization_id: str, key: str) -> None:
        self._organization_settings.pop((str(organization_id), key), None)


class PostgresStore(Store):
    def __init__(self, dsn: str) -> None:
        self._dsn = dsn

    async def _connect(self):
        import psycopg

        # autocommit + no prepared statements => safe behind the Supabase pooler.
        return await psycopg.AsyncConnection.connect(
            self._dsn, autocommit=True, prepare_threshold=None
        )

    async def startup(self) -> None:
        async with await self._connect() as conn:
            await conn.execute(
                "create table if not exists customers ("
                "  id uuid primary key default gen_random_uuid(),"
                "  phone text unique,"
                "  name text,"
                "  created_at timestamptz not null default now()"
                ")"
            )
            await conn.execute(
                "create table if not exists jobs ("
                "  id uuid primary key default gen_random_uuid(),"
                "  customer_id uuid references customers(id),"
                "  fulfillment_technician_id uuid,"
                "  fulfillment_org_id uuid,"
                "  origin_org_id uuid,"
                "  customer_owner_org_id uuid,"
                "  intake_channel_id uuid,"
                "  trust_state text not null default 'intake',"
                "  status text not null default 'draft',"
                "  access_type text,"
                "  situation text,"
                "  urgency text,"
                "  lat double precision,"
                "  lng double precision,"
                "  address text,"
                "  detail jsonb not null default '{}',"
                "  price_quote jsonb,"
                "  final_charge jsonb,"
                "  created_at timestamptz not null default now(),"
                "  updated_at timestamptz not null default now()"
                ")"
            )
            await conn.execute(
                "create table if not exists events ("
                "  id bigserial primary key,"
                "  ticket_id uuid,"
                "  job_id uuid,"
                "  event text not null,"
                "  trust_state text,"
                "  at timestamptz not null default now()"
                ")"
            )
            await conn.execute("alter table events add column if not exists job_id uuid")
            await conn.execute(
                "create table if not exists media ("
                "  id uuid primary key default gen_random_uuid(),"
                "  owner_type text not null,"
                "  owner_id uuid not null,"
                "  kind text not null,"
                "  bucket text not null,"
                "  path text not null,"
                "  visibility text not null default 'private',"
                "  uploaded_by uuid,"
                "  uploaded_at timestamptz not null default now()"
                ")"
            )
            await conn.execute(
                "create table if not exists governance_events ("
                "  id uuid primary key default gen_random_uuid(),"
                "  entity_type text not null check (entity_type in ('organization','technician','user')),"
                "  entity_id uuid not null,"
                "  action text not null,"
                "  reason text,"
                "  actor_id uuid,"
                "  metadata jsonb not null default '{}',"
                "  created_at timestamptz not null default now()"
                ")"
            )
            await conn.execute(
                "create index if not exists idx_governance_events_entity"
                " on governance_events (entity_type, entity_id, created_at desc)"
            )
            await conn.execute(
                "create index if not exists idx_governance_events_actor"
                " on governance_events (actor_id, created_at desc)"
            )
            # Runtime operational settings (migration 0023). Resilience guard so the
            # API boots + seeds even if the migration is behind. Never holds secrets
            # (the is_secret=false CHECK enforces that). updated_by FK omitted here on
            # purpose — the migration owns the authoritative schema; this is a fallback.
            await conn.execute(
                "create table if not exists global_settings ("
                "  key text primary key,"
                "  value jsonb not null,"
                "  value_type text not null"
                "    check (value_type in ('integer','boolean','string','object','array')),"
                "  description text,"
                "  is_secret boolean not null default false,"
                "  is_runtime_editable boolean not null default true,"
                "  updated_at timestamptz not null default now(),"
                "  updated_by uuid,"
                "  check (is_secret = false)"
                ")"
            )
            await conn.execute(
                "insert into global_settings"
                " (key, value, value_type, description, is_secret, is_runtime_editable)"
                " values ('dispatch_offer_ttl_seconds', '300'::jsonb, 'integer',"
                "  'Seconds before a provider-created dispatch offer expires.', false, true)"
                " on conflict (key) do nothing"
            )
            # Migration 0024 tunables — same idempotent seeds, repeated here so the
            # live API self-heals if the migration is behind.
            await conn.execute(
                "insert into global_settings"
                " (key, value, value_type, is_secret, is_runtime_editable) values"
                " ('dispatch_cutover_global_off', 'false'::jsonb, 'boolean', false, true),"
                " ('token_action_max', '30'::jsonb, 'integer', false, true),"
                " ('token_action_window_seconds', '60'::jsonb, 'integer', false, true),"
                " ('login_max_failures', '8'::jsonb, 'integer', false, true),"
                " ('login_window_seconds', '900'::jsonb, 'integer', false, true)"
                " on conflict (key) do nothing"
            )
            await conn.execute(
                "create table if not exists service_categories ("
                "  code text primary key,"
                "  label text not null,"
                "  status text not null default 'draft'"
                "    check (status in ('draft','active','deprecated')),"
                "  sort_order integer not null default 100,"
                "  updated_at timestamptz not null default now(),"
                "  updated_by uuid"
                ")"
            )
            await conn.execute(
                "create table if not exists service_skills ("
                "  code text primary key,"
                "  category_code text not null references service_categories(code),"
                "  label text not null,"
                "  status text not null default 'draft'"
                "    check (status in ('draft','active','deprecated')),"
                "  requires_verification boolean not null default false,"
                "  sort_order integer not null default 100,"
                "  updated_at timestamptz not null default now(),"
                "  updated_by uuid"
                ")"
            )
            await conn.execute(
                "create index if not exists idx_service_skills_category"
                " on service_skills (category_code, sort_order, code)"
            )
            await conn.execute(
                "create table if not exists organization_capabilities ("
                "  organization_id uuid not null,"
                "  skill_code text not null references service_skills(code),"
                "  status text not null default 'active'"
                "    check (status in ('active','inactive')),"
                "  updated_at timestamptz not null default now(),"
                "  updated_by uuid,"
                "  primary key (organization_id, skill_code)"
                ")"
            )
            await conn.execute(
                "create index if not exists idx_organization_capabilities_active"
                " on organization_capabilities (organization_id, status, skill_code)"
            )
            await conn.execute(
                "create table if not exists closeout_item_types ("
                "  code text primary key,"
                "  label text not null,"
                "  status text not null default 'active'"
                "    check (status in ('draft','active','deprecated')),"
                "  default_taxable boolean not null default true,"
                "  default_compensation_eligible boolean not null default false,"
                "  default_reimbursement_eligible boolean not null default false,"
                "  requires_provided_by boolean not null default false,"
                "  requires_note boolean not null default false,"
                "  requires_receipt boolean not null default false,"
                "  sort_order integer not null default 100,"
                "  updated_at timestamptz not null default now(),"
                "  updated_by uuid"
                ")"
            )
            await conn.execute(
                "create index if not exists idx_closeout_item_types_status"
                " on closeout_item_types (status, sort_order, code)"
            )
            for category in default_service_catalog():
                await conn.execute(
                    "insert into service_categories (code, label, status, sort_order)"
                    " values (%s, %s, %s, %s)"
                    " on conflict (code) do nothing",
                    (category["code"], category["label"], category["status"], category["sort_order"]),
                )
                for skill in category.get("skills", []):
                    await conn.execute(
                        "insert into service_skills"
                        " (code, category_code, label, status, requires_verification, sort_order)"
                        " values (%s, %s, %s, %s, %s, %s)"
                        " on conflict (code) do nothing",
                        (
                            skill["code"],
                            category["code"],
                            skill["label"],
                            skill["status"],
                            skill["requires_verification"],
                            skill["sort_order"],
                        ),
                    )
            for item_type in default_closeout_item_types():
                await conn.execute(
                    "insert into closeout_item_types"
                    " (code, label, status, default_taxable,"
                    "  default_compensation_eligible, default_reimbursement_eligible,"
                    "  requires_provided_by, requires_note, requires_receipt, sort_order)"
                    " values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
                    " on conflict (code) do nothing",
                    (
                        item_type["code"],
                        item_type["label"],
                        item_type["status"],
                        item_type["default_taxable"],
                        item_type["default_compensation_eligible"],
                        item_type["default_reimbursement_eligible"],
                        item_type["requires_provided_by"],
                        item_type["requires_note"],
                        item_type["requires_receipt"],
                        item_type["sort_order"],
                    ),
                )
            await conn.execute(
                "insert into organization_capabilities (organization_id, skill_code, status)"
                " select o.id, s.code, 'active'"
                " from organizations o cross join service_skills s"
                " where s.status = 'active'"
                " on conflict (organization_id, skill_code) do nothing"
            )
            await conn.execute("alter table jobs add column if not exists fulfillment_org_id uuid")
            # Fulfillment cutover (migration 0010) — additive columns. Repeated here
            # as add-column-if-not-exists so the live API is resilient if it boots
            # before the migration runs (matches the fulfillment_org_id pattern above).
            for _col in (
                "tracking_token text",
                "assigned_at timestamptz",
                "en_route_at timestamptz",
                "arrived_at timestamptz",
                "in_progress_at timestamptz",
                "completed_pending_at timestamptz",
                "confirmed_at timestamptz",
                "closed_at timestamptz",
                "disputed_at timestamptz",
                "cancelled_at timestamptz",
            ):
                await conn.execute(f"alter table jobs add column if not exists {_col}")
            await conn.execute(
                "create unique index if not exists idx_jobs_tracking_token on jobs (tracking_token)"
            )
            await conn.execute(
                "create table if not exists users ("
                "  id uuid primary key default gen_random_uuid(),"
                "  email text unique,"
                "  phone text unique,"
                "  password_hash text not null,"
                "  display_name text not null,"
                "  status text not null default 'active',"
                "  created_at timestamptz not null default now(),"
                "  updated_at timestamptz not null default now()"
                ")"
            )
            await conn.execute(
                "create table if not exists user_roles ("
                "  user_id uuid not null references users(id) on delete cascade,"
                "  role text not null,"
                "  created_at timestamptz not null default now(),"
                "  primary key (user_id, role)"
                ")"
            )
            await conn.execute(
                "create table if not exists user_organization_memberships ("
                "  user_id uuid not null references users(id) on delete cascade,"
                "  organization_id uuid not null,"
                "  role text not null default 'member',"
                "  status text not null default 'active',"
                "  created_at timestamptz not null default now(),"
                "  primary key (user_id, organization_id)"
                ")"
            )
            await conn.execute(
                "create table if not exists job_reviews ("
                "  id uuid primary key default gen_random_uuid(),"
                "  job_id uuid not null,"
                "  rating integer not null check (rating between 1 and 5),"
                "  tags text[] not null default '{}',"
                "  comment text,"
                "  fulfillment_technician_ref text,"
                "  fulfillment_org_id uuid,"
                "  created_at timestamptz not null default now()"
                ")"
            )
            # Fulfillment cutover (migration 0010) — ticket-scoped customer-safe
            # review fields; additive add-column-if-not-exists for boot resilience.
            for _col in (
                "assigned_technician_id text",
                "customer_owner_org_id uuid",
                "confirmed_at timestamptz",
                "issue_reported boolean not null default false",
            ):
                await conn.execute(f"alter table job_reviews add column if not exists {_col}")
            # Per-channel cutover flip (default OFF) — only if the channel table exists.
            await conn.execute(
                "do $$ begin"
                "  if to_regclass('public.intake_channels') is not null then"
                "    alter table intake_channels"
                "      add column if not exists dispatch_cutover_enabled boolean not null default false;"
                "  end if;"
                " end $$"
            )
            await conn.execute(
                "create table if not exists rating_summaries ("
                "  target_type text not null,"
                "  target_id text not null,"
                "  average_rating numeric(3,2) not null default 0,"
                "  review_count integer not null default 0,"
                "  updated_at timestamptz not null default now(),"
                "  primary key (target_type, target_id)"
                ")"
            )
            await conn.execute(
                "create table if not exists login_attempts ("
                "  id uuid primary key default gen_random_uuid(),"
                "  identifier text not null,"
                "  ip text,"
                "  success boolean not null default false,"
                "  created_at timestamptz not null default now()"
                ")"
            )
            await conn.execute(
                "create table if not exists job_payment_reports ("
                "  id uuid primary key default gen_random_uuid(),"
                "  job_id uuid not null references jobs(id) on delete cascade,"
                "  reported_by text not null check (reported_by in ('technician','customer')),"
                "  amount numeric(10,2) not null check (amount >= 0),"
                "  currency text not null default 'USD',"
                "  method text not null,"
                "  reported_at timestamptz not null default now(),"
                "  updated_at timestamptz not null default now(),"
                "  unique (job_id, reported_by)"
                ")"
            )
            await conn.execute(
                "create index if not exists idx_job_payment_reports_job"
                " on job_payment_reports (job_id)"
            )
            await conn.execute(
                "create table if not exists job_closeout_reports ("
                "  id uuid primary key default gen_random_uuid(),"
                "  job_id uuid not null references jobs(id) on delete cascade,"
                "  reported_by text not null check (reported_by in ('technician')),"
                "  currency text not null default 'USD',"
                "  method text not null,"
                "  subtotal_cents integer not null check (subtotal_cents >= 0),"
                "  taxable_subtotal_cents integer not null check (taxable_subtotal_cents >= 0),"
                "  tax_rate_basis_points integer not null check (tax_rate_basis_points >= 0),"
                "  tax_cents integer not null check (tax_cents >= 0),"
                "  tip_cents integer not null check (tip_cents >= 0),"
                "  card_fee_basis_points integer not null check (card_fee_basis_points >= 0),"
                "  card_fee_fixed_cents integer not null check (card_fee_fixed_cents >= 0),"
                "  card_fee_cents integer not null check (card_fee_cents >= 0),"
                "  total_cents integer not null check (total_cents >= 0),"
                "  no_tax_reason text,"
                "  settings_snapshot jsonb not null default '{}',"
                "  reported_at timestamptz not null default now(),"
                "  updated_at timestamptz not null default now(),"
                "  unique (job_id, reported_by)"
                ")"
            )
            await conn.execute(
                "create table if not exists job_closeout_line_items ("
                "  id uuid primary key default gen_random_uuid(),"
                "  closeout_id uuid not null references job_closeout_reports(id) on delete cascade,"
                "  job_id uuid not null references jobs(id) on delete cascade,"
                "  line_number integer not null,"
                "  item_type_code text not null references closeout_item_types(code),"
                "  description text not null,"
                "  quantity numeric(10,2) not null check (quantity > 0),"
                "  unit_amount_cents integer not null check (unit_amount_cents >= 0),"
                "  line_total_cents integer not null check (line_total_cents >= 0),"
                "  taxable boolean not null default true,"
                "  provided_by text check (provided_by in ('company','technician','customer','third_party')),"
                "  compensation_eligible boolean not null default false,"
                "  reimbursement_eligible boolean not null default false,"
                "  note text,"
                "  unique (closeout_id, line_number)"
                ")"
            )
            await conn.execute(
                "create index if not exists idx_job_closeout_reports_job"
                " on job_closeout_reports (job_id)"
            )
            await conn.execute(
                "create index if not exists idx_job_closeout_line_items_job"
                " on job_closeout_line_items (job_id, closeout_id)"
            )
            await conn.execute(
                "create table if not exists technician_agreements ("
                "  id uuid primary key default gen_random_uuid(),"
                "  organization_id uuid not null references organizations(id) on delete cascade,"
                "  technician_id uuid not null references technicians(id) on delete cascade,"
                "  status text not null default 'draft' check (status in ('draft','active','paused','archived')),"
                "  effective_from date,"
                "  effective_until date,"
                "  default_labor_cut_basis_points integer not null default 5000"
                "    check (default_labor_cut_basis_points between 0 and 10000),"
                "  tip_policy text not null default 'tech_keeps'"
                "    check (tip_policy in ('tech_keeps','company_keeps','split')),"
                "  tip_cut_basis_points integer not null default 10000"
                "    check (tip_cut_basis_points between 0 and 10000),"
                "  card_fee_policy text not null default 'company_pays'"
                "    check (card_fee_policy in ('company_pays','deduct_from_company','split')),"
                "  minimum_payout_cents integer not null default 0 check (minimum_payout_cents >= 0),"
                "  flat_job_bonus_cents integer not null default 0 check (flat_job_bonus_cents >= 0),"
                "  service_area_counties jsonb not null default '[]',"
                "  service_area_zipcodes jsonb not null default '[]',"
                "  service_hours jsonb not null default '{}',"
                "  rules jsonb not null default '{}',"
                "  created_at timestamptz not null default now(),"
                "  updated_at timestamptz not null default now(),"
                "  updated_by uuid references users(id),"
                "  unique (organization_id, technician_id)"
                ")"
            )
            await conn.execute(
                "create index if not exists idx_technician_agreements_org_tech"
                " on technician_agreements (organization_id, technician_id, status)"
            )
            await conn.execute(
                "create table if not exists settlement_periods ("
                "  id uuid primary key default gen_random_uuid(),"
                "  organization_id uuid not null references organizations(id) on delete cascade,"
                "  status text not null default 'draft' check (status in ('draft','locked','paid','void')),"
                "  label text not null,"
                "  period_start date,"
                "  period_end date,"
                "  technician_id uuid references technicians(id),"
                "  job_count integer not null default 0,"
                "  customer_total_cents integer not null default 0,"
                "  tax_cents integer not null default 0,"
                "  card_fee_cents integer not null default 0,"
                "  tech_payout_cents integer not null default 0,"
                "  company_retained_cents integer not null default 0,"
                "  adjustment_cents integer not null default 0,"
                "  final_tech_payout_cents integer not null default 0,"
                "  note text,"
                "  created_by uuid references users(id),"
                "  locked_by uuid references users(id),"
                "  paid_by uuid references users(id),"
                "  created_at timestamptz not null default now(),"
                "  updated_at timestamptz not null default now(),"
                "  locked_at timestamptz,"
                "  paid_at timestamptz"
                ")"
            )
            await conn.execute(
                "create table if not exists settlement_period_jobs ("
                "  id uuid primary key default gen_random_uuid(),"
                "  settlement_period_id uuid not null references settlement_periods(id) on delete cascade,"
                "  job_id uuid not null,"
                "  technician_id uuid,"
                "  row_snapshot jsonb not null,"
                "  tech_payout_cents integer not null default 0,"
                "  company_retained_cents integer not null default 0,"
                "  created_at timestamptz not null default now(),"
                "  unique (settlement_period_id, job_id)"
                ")"
            )
            await conn.execute(
                "create table if not exists settlement_adjustments ("
                "  id uuid primary key default gen_random_uuid(),"
                "  settlement_period_id uuid not null references settlement_periods(id) on delete cascade,"
                "  amount_cents integer not null,"
                "  reason text not null,"
                "  created_by uuid references users(id),"
                "  created_at timestamptz not null default now()"
                ")"
            )
            await conn.execute(
                "create index if not exists idx_settlement_periods_org_status"
                " on settlement_periods (organization_id, status, created_at desc)"
            )
            await conn.execute(
                "create table if not exists settlement_payments ("
                "  id uuid primary key default gen_random_uuid(),"
                "  organization_id uuid not null references organizations(id) on delete cascade,"
                "  technician_id uuid not null references technicians(id),"
                "  settlement_period_id uuid references settlement_periods(id),"
                "  source_period_start date,"
                "  source_period_end date,"
                "  direction text not null check (direction in ('company_to_technician','technician_to_company')),"
                "  amount_cents integer not null check (amount_cents > 0),"
                "  payment_method text not null,"
                "  reference_number text,"
                "  paid_on date not null,"
                "  note text,"
                "  status text not null default 'pending' check (status in ('pending','confirmed','rejected','voided')),"
                "  submitted_by_role text not null check (submitted_by_role in ('provider','technician')),"
                "  submitted_by uuid references users(id),"
                "  confirmed_by uuid references users(id),"
                "  confirmed_at timestamptz,"
                "  rejected_by uuid references users(id),"
                "  rejected_at timestamptz,"
                "  rejected_reason text,"
                "  voided_by uuid references users(id),"
                "  voided_at timestamptz,"
                "  void_reason text,"
                "  created_at timestamptz not null default now(),"
                "  updated_at timestamptz not null default now()"
                ")"
            )
            await conn.execute(
                "create index if not exists idx_settlement_payments_org_tech"
                " on settlement_payments (organization_id, technician_id, paid_on desc)"
            )
            await conn.execute("create index if not exists idx_jobs_status on jobs (status)")
            await conn.execute(
                "create index if not exists idx_jobs_trust_state on jobs (trust_state)"
            )
            await conn.execute("create index if not exists idx_jobs_customer on jobs (customer_id)")
            await conn.execute(
                "create index if not exists idx_media_owner on media (owner_type, owner_id)"
            )
            await conn.execute("create index if not exists idx_user_roles_user on user_roles (user_id)")
            await conn.execute(
                "create index if not exists idx_user_memberships_org"
                " on user_organization_memberships (organization_id)"
            )
            await conn.execute("create index if not exists idx_job_reviews_job on job_reviews (job_id)")
            await conn.execute(
                "create index if not exists idx_job_reviews_technician"
                " on job_reviews (fulfillment_technician_ref)"
            )
            await conn.execute(
                "create index if not exists idx_login_attempts_identifier_time"
                " on login_attempts (lower(identifier), created_at)"
            )
            if config.DEMO_SEED:
                await self._seed_demo_auth(conn)

    async def _seed_demo_auth(self, conn) -> None:
        password_hash = hash_password(DEMO_PASSWORD, salt="cluexp-demo-salt")
        provider_org_id = None
        try:
            cur = await conn.execute(
                "insert into organizations (display_name, legal_name, slug, status, subscription_status, email)"
                " values (%s, %s, %s, %s, %s, %s)"
                " on conflict (slug) do update set display_name = excluded.display_name"
                " returning id",
                (
                    "Metro Key Partners",
                    "Metro Key Partners LLC",
                    "metro-key",
                    "eligible",
                    "active",
                    "dispatch@metrokey.example",
                ),
            )
            row = await cur.fetchone()
            provider_org_id = row[0] if row else None
        except Exception:
            provider_org_id = None

        async def ensure_user(
            email: str,
            display_name: str,
            roles: list[str],
            org_id=None,
            phone=None,
            membership_role: str = "provider_admin",
        ):
            cur = await conn.execute(
                "insert into users (email, phone, password_hash, display_name, status)"
                " values (%s, %s, %s, %s, 'active')"
                " on conflict (email) do update set"
                "  display_name = excluded.display_name,"
                "  password_hash = excluded.password_hash,"
                "  updated_at = now()"
                " returning id",
                (email, phone, password_hash, display_name),
            )
            row = await cur.fetchone()
            if not row:
                return None
            user_id = row[0]
            for role in roles:
                await conn.execute(
                    "insert into user_roles (user_id, role) values (%s, %s)"
                    " on conflict do nothing",
                    (user_id, role),
                )
            if org_id:
                await conn.execute(
                    "insert into user_organization_memberships (user_id, organization_id, role, status)"
                    " values (%s, %s, %s, 'active')"
                    " on conflict (user_id, organization_id) do update"
                    " set role = excluded.role, status = 'active'",
                    (user_id, org_id, membership_role),
                )
            return user_id

        await ensure_user("avery@cluexp.com", "Avery Knox", ["platform_admin"])
        await ensure_user(
            "dispatch@metrokey.example",
            "Nadia Reyes",
            ["provider_admin", "dispatcher"],
            provider_org_id,
            "+15550140199",
        )
        # Jordan is seeded as a MetroKey affiliate (below) so the company's dispatcher
        # can assign him during the demo — all demo technicians belong to MetroKey.
        if provider_org_id:
            cur = await conn.execute(
                "insert into organization_teams"
                " (organization_id, name, description, team_type, status)"
                " values (%s, 'Manhattan Response', 'Primary urgent-response roster', 'department', 'active')"
                " on conflict do nothing returning id",
                (provider_org_id,),
            )
            team_row = await cur.fetchone()
            if not team_row:
                cur = await conn.execute(
                    "select id from organization_teams"
                    " where organization_id = %s and name = 'Manhattan Response' limit 1",
                    (provider_org_id,),
                )
                team_row = await cur.fetchone()
            team_id = team_row[0] if team_row else None
            for email, name, phone, lat, lng, rating in [
                ("jordan@cluexp.example", "Jordan Lee", "+15550142201", 40.7580, -73.9855, 4.9),
                ("marcus@metrokey.example", "Marcus Reyes", "+15550142211", 40.7831, -73.9712, 4.9),
                ("lena@metrokey.example", "Lena Ortiz", "+15550142212", 40.7484, -73.9857, 4.7),
            ]:
                technician_id = await ensure_user(
                    email, name, ["technician"], provider_org_id, phone, "technician"
                )
                if not technician_id:
                    continue
                await conn.execute(
                    "insert into technicians"
                    " (id, display_name, email, phone, status, vetting_status, skills,"
                    " service_area_center_lat, service_area_center_lng, service_area_radius_km,"
                    " current_lat, current_lng, location_updated_at, rating, is_available,"
                    " provider_type, primary_organization_id)"
                    " values (%s, %s, %s, %s, 'active', 'verified',"
                    " '{locksmith.residential_lockout,locksmith.commercial_lockout,locksmith.vehicle_lockout}',"
                    " %s, %s, 25, %s, %s, now(), %s, true, 'affiliate', %s)"
                    " on conflict (id) do update set status = 'active', vetting_status = 'verified',"
                    " skills = excluded.skills,"
                    " is_available = true, current_lat = excluded.current_lat,"
                    " current_lng = excluded.current_lng, location_updated_at = now(),"
                    " provider_type = 'affiliate',"
                    " primary_organization_id = excluded.primary_organization_id",
                    (
                        technician_id, name, email, phone, lat, lng, lat, lng,
                        rating, provider_org_id,
                    ),
                )
                await conn.execute(
                    "insert into organization_technicians"
                    " (organization_id, technician_id, role, status, activated_at)"
                    " values (%s, %s, 'affiliate_technician', 'active', now())"
                    " on conflict (organization_id, technician_id) where ended_at is null"
                    " do update set status = 'active'",
                    (provider_org_id, technician_id),
                )
                if team_id:
                    await conn.execute(
                        "insert into organization_team_technicians (team_id, technician_id)"
                        " values (%s, %s) on conflict do nothing",
                        (team_id, technician_id),
                    )

        # Tampa demo provider (slug `florida-locksmith`). Idempotent upsert so the
        # company + roster are always present in a fresh demo DB. Metro Key job
        # cleanup and demo-job creation live in scripts/reset_demo_providers.py —
        # they are reset-time operations, intentionally NOT run on every boot.
        try:
            from api import demo_seed

            await demo_seed.seed_florida_locksmith(conn, password_hash=password_hash)
        except Exception:
            # Never let the demo provider seed block startup (e.g. schema behind).
            pass

    async def get(self, ticket_id: UUID) -> Ticket | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select detail from jobs where id = %s", (str(ticket_id),)
            )
            row = await cur.fetchone()
            if row is None:
                # Compatibility for tickets created before Sprint 1's relational
                # store switch. New writes go only to jobs.
                cur = await conn.execute("select to_regclass('public.tickets')")
                has_legacy_tickets = (await cur.fetchone())[0] is not None
                if has_legacy_tickets:
                    cur = await conn.execute(
                        "select data from tickets where ticket_id = %s", (str(ticket_id),)
                    )
                    row = await cur.fetchone()
        return Ticket.model_validate(row[0]) if row else None

    async def save(self, ticket: Ticket, origin: dict | None = None) -> None:
        from psycopg.types.json import Jsonb

        payload = ticket.model_dump(mode="json")
        location = payload.get("location") if isinstance(payload.get("location"), dict) else {}
        assignment = (
            payload.get("technician_assignment")
            if isinstance(payload.get("technician_assignment"), dict)
            else {}
        )
        origin = origin or {}
        customer_phone, customer_name = _customer_from_payload(payload)
        customer_phone = customer_phone or origin.get("customer_phone")
        customer_name = customer_name or origin.get("customer_name")
        technician_id = _uuid_or_none(assignment.get("technician_id"))
        origin_org_id = _uuid_or_none(origin.get("origin_org_id"))
        customer_owner_org_id = _uuid_or_none(origin.get("customer_owner_org_id"))
        intake_channel_id = _uuid_or_none(origin.get("intake_channel_id"))

        async with await self._connect() as conn:
            customer_id = None
            if customer_phone:
                cur = await conn.execute(
                    "insert into customers (phone, name)"
                    " values (%s, %s)"
                    " on conflict (phone) do update"
                    " set name = coalesce(excluded.name, customers.name)"
                    " returning id",
                    (customer_phone, customer_name),
                )
                row = await cur.fetchone()
                customer_id = row[0] if row else None

            await conn.execute(
                "insert into jobs ("
                "  id, customer_id, fulfillment_technician_id,"
                "  origin_org_id, customer_owner_org_id, intake_channel_id,"
                "  trust_state, status, access_type,"
                "  situation, urgency, lat, lng, address, detail, price_quote,"
                "  final_charge, tracking_token, created_at, updated_at"
                ") values ("
                "  %s, %s, %s,"
                "  %s, %s, %s,"
                "  %s, %s, %s,"
                "  %s, %s, %s, %s, %s, %s, %s,"
                "  %s, %s, %s, now()"
                ")"
                " on conflict (id) do update set"
                "  customer_id = coalesce(excluded.customer_id, jobs.customer_id),"
                "  fulfillment_technician_id = excluded.fulfillment_technician_id,"
                "  origin_org_id = coalesce(jobs.origin_org_id, excluded.origin_org_id),"
                "  customer_owner_org_id = coalesce(jobs.customer_owner_org_id, excluded.customer_owner_org_id),"
                "  intake_channel_id = coalesce(jobs.intake_channel_id, excluded.intake_channel_id),"
                "  trust_state = excluded.trust_state,"
                # Never overwrite an operational status (pending_dispatch and beyond)
                # with a legacy intake status (draft/partial/complete). Once the job
                # enters the fulfillment ladder only set_job_status may advance it.
                "  status = CASE"
                "    WHEN jobs.status = ANY(ARRAY["
                "      'pending_dispatch','assigned','en_route','arrived','in_progress',"
                "      'completed_pending_customer','completed_confirmed',"
                "      'completed_auto_closed','disputed','cancelled','no_show'])"
                "    THEN jobs.status ELSE excluded.status END,"
                "  access_type = excluded.access_type,"
                "  situation = excluded.situation,"
                "  urgency = excluded.urgency,"
                "  lat = excluded.lat,"
                "  lng = excluded.lng,"
                "  address = excluded.address,"
                "  detail = excluded.detail,"
                "  price_quote = excluded.price_quote,"
                "  final_charge = excluded.final_charge,"
                # token is minted once at create and never rotated by later saves.
                "  tracking_token = coalesce(jobs.tracking_token, excluded.tracking_token),"
                "  updated_at = now()",
                (
                    str(ticket.ticket_id),
                    customer_id,
                    technician_id,
                    origin_org_id,
                    customer_owner_org_id,
                    intake_channel_id,
                    _trust_state_value(ticket),
                    _enum_value(ticket.status),
                    _enum_value(ticket.access_type),
                    _enum_value(ticket.situation),
                    _enum_value(ticket.urgency),
                    location.get("lat"),
                    location.get("lng"),
                    location.get("raw_text"),
                    Jsonb(payload),
                    Jsonb(payload.get("price_quote")) if payload.get("price_quote") else None,
                    Jsonb(payload.get("final_charge")) if payload.get("final_charge") else None,
                    _new_tracking_token(),
                    ticket.created_at,
                ),
            )

    async def resolve_intake_channel(self, slug: str | None) -> dict | None:
        if not slug:
            return None
        try:
            async with await self._connect() as conn:
                cur = await conn.execute(
                    "select c.id, c.organization_id,"
                    " coalesce(c.dispatch_cutover_enabled, false),"
                    " o.display_name, o.phone"
                    " from intake_channels c"
                    " join organizations o on o.id = c.organization_id"
                    " where c.slug = %s and c.active = true",
                    (slug,),
                )
                row = await cur.fetchone()
        except Exception:
            # Table/column not present yet (pre-0004 / pre-0010) or lookup failed
            # → public intake (legacy path).
            return None
        if not row:
            return None
        channel_id, org_id, cutover, org_name, org_phone = row
        return {
            "intake_channel_id": channel_id,
            "origin_org_id": org_id,
            "customer_owner_org_id": org_id,  # origin owns the customer (SYSTEM-DESIGN §20.4)
            "dispatch_cutover_enabled": bool(cutover),
            "organization_name": org_name,
            # The owning provider's own dispatch line (organizations.phone,
            # provider-editable via PATCH /provider/organization).
            "dispatch_phone": org_phone,
        }

    async def log_event(self, ticket: Ticket, event: str) -> None:
        async with await self._connect() as conn:
            await conn.execute(
                "insert into events (ticket_id, job_id, event, trust_state)"
                " values (%s, %s, %s, %s)",
                (
                    str(ticket.ticket_id),
                    str(ticket.ticket_id),
                    event,
                    _trust_state_value(ticket),
                ),
            )

    async def record_media(
        self,
        *,
        owner_type: str,
        owner_id: UUID,
        kind: str,
        bucket: str,
        path: str,
        visibility: str,
    ) -> str:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "insert into media (owner_type, owner_id, kind, bucket, path, visibility)"
                " values (%s, %s, %s, %s, %s, %s)"
                " returning id",
                (owner_type, str(owner_id), kind, bucket, path, visibility),
            )
            row = await cur.fetchone()
        return str(row[0])

    async def authenticate_user(self, identifier: str, password: str) -> dict | None:
        normalized = identifier.strip().lower()
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select id, password_hash from users"
                " where status = 'active' and (lower(email) = %s or phone = %s)",
                (normalized, identifier.strip()),
            )
            row = await cur.fetchone()
            if row is None or not verify_password(password, row[1]):
                return None
            return await self._session_for_user(conn, str(row[0]))

    async def login_rate_limited(self, identifier: str) -> bool:
        normalized = identifier.strip().lower()
        # Runtime-tunable via global_settings (falls back to env → hardcoded default).
        window = await runtime_settings.resolve(self, "login_window_seconds")
        max_failures = await runtime_settings.resolve(self, "login_max_failures")
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select count(*) from login_attempts"
                " where lower(identifier) = %s and success = false"
                " and created_at >= now() - (%s * interval '1 second')",
                (normalized, window),
            )
            row = await cur.fetchone()
        return bool(row and row[0] >= max_failures)

    async def record_login_attempt(
        self, identifier: str, *, success: bool, ip: str | None
    ) -> None:
        normalized = identifier.strip().lower()
        async with await self._connect() as conn:
            if success:
                await conn.execute(
                    "delete from login_attempts where lower(identifier) = %s",
                    (normalized,),
                )
                return
            await conn.execute(
                "insert into login_attempts (identifier, ip, success) values (%s, %s, false)",
                (normalized, ip),
            )
            await conn.execute(
                "delete from login_attempts where created_at < now() - interval '7 days'"
            )

    async def get_user_session(self, user_id: str) -> dict | None:
        async with await self._connect() as conn:
            return await self._session_for_user(conn, user_id)

    async def _session_for_user(self, conn, user_id: str) -> dict | None:
        cur = await conn.execute(
            "select id, email, phone, display_name, locale from users"
            " where id = %s and status = 'active'",
            (user_id,),
        )
        user_row = await cur.fetchone()
        if user_row is None:
            return None
        cur = await conn.execute(
            "select role from user_roles where user_id = %s order by role",
            (user_id,),
        )
        roles = [row[0] for row in await cur.fetchall()]
        cur = await conn.execute(
            "select m.organization_id, o.display_name, o.status"
            " from user_organization_memberships m"
            " left join organizations o on o.id = m.organization_id"
            " where m.user_id = %s and m.status = 'active'"
            " order by m.created_at"
            " limit 1",
            (user_id,),
        )
        org_row = await cur.fetchone()
        # Technician profile is 1:1 with the user (same id) when self-registered.
        cur = await conn.execute(
            "select id, status, vetting_status, is_available, display_name, phone,"
            " skills, service_area_radius_km, profile_photo_url, profile_photo_status,"
            " location_updated_at"
            " from technicians where id = %s",
            (user_id,),
        )
        tech_row = await cur.fetchone()
        tech_affiliations: list[dict] = []
        if tech_row:
            acur = await conn.execute(
                "select ot.id, ot.organization_id, o.display_name, ot.status,"
                " ot.affiliation_type, ot.exclusivity, ot.dispatch_allowed, ot.ended_at"
                " from organization_technicians ot"
                " join organizations o on o.id = ot.organization_id"
                " where ot.technician_id = %s"
                " order by ot.ended_at is null desc, ot.starts_at desc",
                (user_id,),
            )
            tech_affiliations = [
                {
                    "id": str(r[0]), "organization_id": str(r[1]), "organization_name": r[2],
                    "status": r[3], "affiliation_type": r[4], "exclusivity": r[5],
                    "dispatch_allowed": r[6], "ended_at": r[7].isoformat() if r[7] else None,
                }
                for r in await acur.fetchall()
            ]
        return {
            "user": {
                "id": str(user_row[0]),
                "email": user_row[1],
                "phone": user_row[2],
                "display_name": user_row[3],
                "locale": user_row[4],
            },
            "roles": roles,
            "active_organization_id": str(org_row[0]) if org_row else None,
            "organization_name": org_row[1] if org_row else None,
            "organization_status": org_row[2] if org_row else None,
            "technician": {
                "id": str(tech_row[0]),
                "status": tech_row[1],
                "vetting_status": tech_row[2],
                "is_available": tech_row[3],
                "display_name": tech_row[4],
                "phone": tech_row[5],
                "skills": list(tech_row[6] or []),
                "service_area_radius_km": tech_row[7],
                "approved": tech_row[1] == "active" and tech_row[2] == "verified",
                "photo_url": tech_row[8],
                "photo_status": tech_row[9] or "none",
                "location_updated_at": tech_row[10].isoformat() if tech_row[10] else None,
                "affiliations": tech_affiliations,
            }
            if tech_row
            else None,
        }

    async def record_review(
        self,
        *,
        ticket_id: UUID,
        rating: int,
        tags: list[str],
        comment: str | None,
    ) -> dict:
        from psycopg.types.json import Jsonb

        ticket = await self.get(ticket_id)
        if ticket is None:
            raise KeyError(str(ticket_id))
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select fulfillment_technician_id, fulfillment_org_id from jobs where id = %s",
                (str(ticket_id),),
            )
            row = await cur.fetchone()
            technician_ref = str(row[0]) if row and row[0] else (
                ticket.technician_assignment.technician_id if ticket.technician_assignment else None
            )
            fulfillment_org_id = row[1] if row else None
            cur = await conn.execute(
                "insert into job_reviews ("
                " job_id, rating, tags, comment, fulfillment_technician_ref, fulfillment_org_id"
                ") values (%s, %s, %s, %s, %s, %s)"
                " returning id, created_at",
                (str(ticket_id), rating, tags, comment, technician_ref, fulfillment_org_id),
            )
            review_row = await cur.fetchone()
            targets = []
            if technician_ref:
                targets.append(("technician", technician_ref))
            if fulfillment_org_id:
                targets.append(("organization", str(fulfillment_org_id)))
            for target_type, target_id in targets:
                await conn.execute(
                    "insert into rating_summaries (target_type, target_id, average_rating, review_count)"
                    " select %s, %s, avg(rating)::numeric(3,2), count(*)::integer"
                    " from job_reviews"
                    " where (%s = 'technician' and fulfillment_technician_ref = %s)"
                    "    or (%s = 'organization' and fulfillment_org_id::text = %s)"
                    " on conflict (target_type, target_id) do update set"
                    "  average_rating = excluded.average_rating,"
                    "  review_count = excluded.review_count,"
                    "  updated_at = now()",
                    (target_type, target_id, target_type, target_id, target_type, target_id),
                )
            if technician_ref:
                await conn.execute(
                    "update technicians t set rating = s.average_rating"
                    " from rating_summaries s"
                    " where s.target_type = 'technician' and s.target_id = %s"
                    " and t.id::text = s.target_id",
                    (technician_ref,),
                )
            payload = ticket.model_dump(mode="json")
            payload["latest_review"] = {
                "rating": rating,
                "tags": tags,
                "comment": comment,
                "created_at": review_row[1].isoformat() if review_row else None,
            }
            await conn.execute(
                "update jobs set detail = %s, updated_at = now() where id = %s",
                (Jsonb(payload), str(ticket_id)),
            )
        return {
            "id": str(review_row[0]) if review_row else None,
            "ticket_id": str(ticket_id),
            "rating": rating,
            "tags": tags,
            "comment": comment,
            "technician_ref": technician_ref,
            "organization_id": str(fulfillment_org_id) if fulfillment_org_id else None,
        }

    async def get_dispatch_job(self, job_id: UUID) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select id, lat, lng, access_type, fulfillment_technician_id,"
                " customer_owner_org_id, fulfillment_policy, dispatch_attempts, trust_state,"
                " status"
                " from jobs where id = %s",
                (str(job_id),),
            )
            row = await cur.fetchone()
        if not row:
            return None
        return {
            "id": str(row[0]),
            "lat": row[1],
            "lng": row[2],
            "access_type": row[3],
            "fulfillment_technician_id": str(row[4]) if row[4] else None,
            "customer_owner_org_id": str(row[5]) if row[5] else None,
            "fulfillment_policy": row[6],
            "dispatch_attempts": row[7] or 0,
            "trust_state": row[8],
            "status": row[9],
        }

    async def list_available_technicians(self) -> list[dict]:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select t.id, t.display_name, t.skills, t.service_area_center_lat,"
                " t.service_area_center_lng, t.service_area_radius_km, t.rating,"
                " t.is_available, t.provider_type, t.primary_organization_id,"
                " coalesce(array_remove(array_agg(distinct ot.organization_id)"
                "   filter (where ot.status = 'active' and ot.dispatch_allowed"
                "     and ot.ended_at is null), null), '{}') as affiliated,"
                " count(ot.technician_id)::integer as affiliation_count"
                " from technicians t"
                " left join organization_technicians ot on ot.technician_id = t.id"
                " where t.status = 'active' and t.vetting_status = 'verified'"
                " and t.is_available = true"
                " group by t.id"
            )
            rows = await cur.fetchall()
        result = []
        for r in rows:
            primary = str(r[9]) if r[9] else None
            affiliated = [str(o) for o in (r[10] or [])]
            has_affiliations = (r[11] or 0) > 0
            fallback_orgs = [primary] if primary and not has_affiliations else []
            org_ids = list({oid for oid in (fallback_orgs + affiliated) if oid})
            result.append(
                {
                    "id": str(r[0]),
                    "display_name": r[1],
                    "skills": list(r[2] or []),
                    "service_area_center_lat": r[3],
                    "service_area_center_lng": r[4],
                    "service_area_radius_km": r[5],
                    "rating": float(r[6]) if r[6] is not None else 0.0,
                    "is_available": r[7],
                    "provider_type": r[8],
                    "primary_organization_id": primary,
                    "org_ids": org_ids,
                }
            )
        return result

    async def create_dispatch_offers(
        self, job_id: UUID, ranked: list[dict], expires_at: datetime
    ) -> list[dict]:
        offers: list[dict] = []
        async with await self._connect() as conn:
            # Re-dispatch is idempotent: retire any still-open offers first.
            await conn.execute(
                "update dispatch_offers set status = 'superseded', responded_at = now()"
                " where job_id = %s and status = 'offered'",
                (str(job_id),),
            )
            for rank, tech in enumerate(ranked):
                org_id = tech.get("primary_organization_id")
                cur = await conn.execute(
                    "insert into dispatch_offers"
                    " (id, job_id, technician_id, status, rank, offered_at, expires_at, organization_id)"
                    " values (gen_random_uuid(), %s, %s, 'offered', %s, now(), %s, %s)"
                    " returning id",
                    (str(job_id), str(tech["id"]), rank, expires_at, org_id),
                )
                row = await cur.fetchone()
                offers.append(
                    {
                        "id": str(row[0]),
                        "job_id": str(job_id),
                        "technician_id": str(tech["id"]),
                        "organization_id": org_id,
                        "rank": rank,
                        "status": "offered",
                        "dist_km": tech.get("dist_km"),
                    }
                )
        return offers

    async def accept_dispatch_offer(self, offer_id: UUID) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select job_id, technician_id, organization_id, status"
                " from dispatch_offers where id = %s",
                (str(offer_id),),
            )
            offer = await cur.fetchone()
            if not offer:
                return None
            job_id, tech_id, org_id, status = offer[0], offer[1], offer[2], offer[3]
            if status != "offered":
                return {"accepted": False, "reason": status, "job_id": str(job_id)}
            # Atomic first-accept-wins: only one accept can win. Guard on
            # status='pending_dispatch' so that a cancellation or concurrent accept
            # that changed the job status before this UPDATE causes this path to fail
            # cleanly — no technician or trust_state is set on a cancelled job.
            cur = await conn.execute(
                "update jobs set fulfillment_technician_id = %s, fulfillment_org_id = %s,"
                " trust_state = 'matched',"
                " status = %s,"
                " assigned_at = coalesce(assigned_at, now()),"
                " updated_at = now()"
                " where id = %s"
                "   and status = %s"
                "   and fulfillment_technician_id is null"
                " returning id",
                (
                    str(tech_id), str(org_id) if org_id else None,
                    STATUS_ASSIGNED,
                    str(job_id),
                    STATUS_PENDING_DISPATCH,
                ),
            )
            won = await cur.fetchone()
            if not won:
                # Revoke the offer without touching trust_state or assignment.
                await conn.execute(
                    "update dispatch_offers set status = 'superseded', responded_at = now()"
                    " where id = %s and status = 'offered'",
                    (str(offer_id),),
                )
                return {"accepted": False, "reason": "job_not_pending", "job_id": str(job_id)}
            await conn.execute(
                "update dispatch_offers set status = 'accepted', responded_at = now() where id = %s",
                (str(offer_id),),
            )
            await conn.execute(
                "update dispatch_offers set status = 'superseded', responded_at = now()"
                " where job_id = %s and id <> %s and status = 'offered'",
                (str(job_id), str(offer_id)),
            )
        return {
            "accepted": True,
            "job_id": str(job_id),
            "technician_id": str(tech_id),
            "organization_id": str(org_id) if org_id else None,
        }

    async def bump_dispatch_attempt(self, job_id: UUID) -> int:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "update jobs set dispatch_attempts = dispatch_attempts + 1, updated_at = now()"
                " where id = %s returning dispatch_attempts",
                (str(job_id),),
            )
            row = await cur.fetchone()
        return row[0] if row else 0

    async def expire_stale_offers(self) -> int:
        """Mark past-deadline offers expired and return affected jobs to
        pending_dispatch when no active offer remains."""
        async with await self._connect() as conn:
            cur = await conn.execute(
                "update dispatch_offers set status = 'expired', responded_at = now()"
                " where status = 'offered' and expires_at is not null and expires_at < now()"
                " returning job_id"
            )
            rows = await cur.fetchall()
            if rows:
                job_ids = list({str(r[0]) for r in rows})
                # Return jobs to the queue only when no sibling offer is still active.
                for jid in job_ids:
                    await conn.execute(
                        "update jobs set status = 'pending_dispatch', updated_at = now()"
                        " where id = %s and status = 'pending_dispatch'"
                        "   and not exists ("
                        "     select 1 from dispatch_offers"
                        "     where job_id = %s and status = 'offered')",
                        (jid, jid),
                    )
        return len(rows)

    async def list_dispatchable_jobs(
        self, *, max_attempts: int, total_timeout_seconds: int, limit: int = 100
    ) -> list[dict]:
        """Unmatched jobs already in the dispatch pipeline whose offers have all
        lapsed, that are not exhausted (attempts<max) and within the total window.
        These are the jobs the sweep re-dispatches."""
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select id, lat, lng, access_type, customer_owner_org_id,"
                " fulfillment_policy, dispatch_attempts"
                " from jobs j"
                " where j.fulfillment_technician_id is null"
                "   and j.dispatch_attempts > 0"
                "   and j.dispatch_attempts < %s"
                "   and extract(epoch from (now() - j.created_at)) < %s"
                "   and not exists ("
                "     select 1 from dispatch_offers o where o.job_id = j.id"
                "       and o.status = 'offered' and (o.expires_at is null or o.expires_at > now()))"
                " order by j.created_at asc limit %s",
                (max_attempts, total_timeout_seconds, limit),
            )
            rows = await cur.fetchall()
        return [
            {
                "id": str(r[0]),
                "lat": r[1],
                "lng": r[2],
                "access_type": r[3],
                "customer_owner_org_id": str(r[4]) if r[4] else None,
                "fulfillment_policy": r[5],
                "dispatch_attempts": r[6] or 0,
            }
            for r in rows
        ]

    async def get_dispatch_status(
        self, ticket_id: UUID, *, max_attempts: int, total_timeout_seconds: int
    ) -> dict | None:
        """Customer-safe tracking read. Pure relational; never creates offers and
        never exposes candidates, scoring, rosters, or internal IDs."""
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select fulfillment_technician_id, fulfillment_org_id, customer_owner_org_id,"
                " status, dispatch_attempts, lat, lng,"
                " extract(epoch from (now() - created_at))::int"
                " from jobs where id = %s",
                (str(ticket_id),),
            )
            job = await cur.fetchone()
            if not job:
                return None
            tech_id, org_id, owner_org_id, job_status, attempts, lat, lng, age = job
            attempts = attempts or 0
            cur = await conn.execute(
                "select"
                " count(*) filter (where status='offered' and (expires_at is null or expires_at > now())),"
                " count(*),"
                " max(expires_at) filter (where status='offered' and (expires_at is null or expires_at > now()))"
                " from dispatch_offers where job_id = %s",
                (str(ticket_id),),
            )
            orow = await cur.fetchone()
            active, total, next_expiry = orow[0] or 0, orow[1] or 0, orow[2]
            matched = tech_id is not None
            timed_out = (age or 0) >= total_timeout_seconds
            state = resolve_dispatch_state(
                matched=matched,
                active_offers=active,
                total_offers=total,
                attempts=attempts,
                max_attempts=max_attempts,
                timed_out=timed_out,
            )
            terminal = is_terminal(
                state, attempts=attempts, max_attempts=max_attempts, timed_out=timed_out
            )
            assignment = None
            if matched:
                assignment = await self._safe_assignment(
                    conn, tech_id, org_id, owner_org_id, lat, lng, ticket_id, job_status
                )
            # Payment the technician reported collecting — shown to the customer so
            # they view/acknowledge it when confirming completion (single source of
            # truth; the customer does not enter a separate amount).
            payment = None
            pcur = await conn.execute(
                "select amount, currency, method from job_payment_reports"
                " where job_id = %s and reported_by = 'technician'",
                (str(ticket_id),),
            )
            prow = await pcur.fetchone()
            if prow:
                payment = {"amount": float(prow[0]), "currency": prow[1], "method": prow[2]}
            closeout = (await self._closeouts_for(conn, [str(ticket_id)])).get(str(ticket_id))
        from api.dispatch import TERMINAL_STATUSES
        # Blind tracking: remove dispatch internals (attempts, offers, expiry)
        # Customer sees only: searching / matched / failed (Uber-style)
        return {
            "state": state,
            "terminal": terminal,
            # Operational fulfillment fields (cutover). For legacy jobs these are
            # benign: status is the intake status and no customer action is offered.
            "status": job_status,
            "closed": job_status in TERMINAL_STATUSES,
            "customer_actions": customer_actions(job_status),
            "assignment": assignment,
            # Customer's own destination (their address) — only while live tracking is
            # allowed, so the map has a tech marker + destination to plot.
            "destination": (
                {"lat": float(lat), "lng": float(lng)}
                if (may_show_live_tracking(job_status) and lat is not None and lng is not None)
                else None
            ),
            "payment": payment,
            "closeout": closeout,
        }

    async def _safe_assignment(
        self, conn, tech_id, fulfillment_org_id, owner_org_id, job_lat, job_lng, job_id, job_status
    ) -> dict | None:
        cur = await conn.execute(
            "select display_name, rating, provider_type, current_lat, current_lng,"
            " service_area_center_lat, service_area_center_lng, location_updated_at,"
            " profile_photo_url, profile_photo_status"
            " from technicians where id = %s",
            (str(tech_id),),
        )
        t = await cur.fetchone()
        if not t:
            return None
        (display_name, rating, _provider_type, cur_lat, cur_lng, sa_lat, sa_lng, loc_at,
         photo_url, photo_status) = t
        # Customer-safe identity: expose the photo only when it is approved; otherwise
        # the UI shows a "Photo pending verification" fallback. Only ever reached after
        # assignment (this method runs for a matched job), so no pre-assignment leak.
        technician_photo_url = photo_url if (photo_status == "approved" and photo_url) else None

        async def _org_name(oid):
            if not oid:
                return None
            c = await conn.execute("select display_name from organizations where id = %s", (str(oid),))
            r = await c.fetchone()
            return r[0] if r else None

        customer_owner = await _org_name(owner_org_id)
        provider_company = await _org_name(fulfillment_org_id)
        if fulfillment_org_id:
            fulfillment_type = (
                "company_technician"
                if str(fulfillment_org_id) == str(owner_org_id)
                else "network_provider"
            )
        else:
            fulfillment_type = "independent_technician"

        t_lat = cur_lat if cur_lat is not None else sa_lat
        t_lng = cur_lng if cur_lng is not None else sa_lng
        eta_min, eta_max = eta_range_from_km(haversine_km(job_lat, job_lng, t_lat, t_lng))

        cur = await conn.execute(
            "select responded_at from dispatch_offers"
            " where job_id = %s and technician_id = %s and status = 'accepted'"
            " order by responded_at desc limit 1",
            (str(job_id), str(tech_id)),
        )
        ar = await cur.fetchone()
        assigned_at = ar[0] if ar else None

        # Safe live location: only the technician's coarse current position, and only
        # while the job is in a FULFILLMENT status (en_route/arrived/in_progress) AND
        # the position is fresh (else a stale last-known point reads as "live"). No
        # internal IDs, no roster, no service-area fallback — that is not "live".
        show_live = (
            may_show_live_tracking(job_status)
            and cur_lat is not None
            and cur_lng is not None
            and location_is_fresh(
                loc_at,
                now=datetime.now(tz=timezone.utc),
                threshold_minutes=config.LOCATION_ONLINE_THRESHOLD_MINUTES,
            )
        )
        return {
            "customer_owner": customer_owner,
            "fulfillment_type": fulfillment_type,
            "provider_company": provider_company,
            "technician_display_name": display_name,
            "technician_photo_url": technician_photo_url,
            "role": "Verified Technician",
            "rating": float(rating) if rating is not None else None,
            "eta_min": eta_min,
            "eta_max": eta_max,
            "eta_is_estimate": True,
            "assigned_at": assigned_at.isoformat() if assigned_at else None,
            "job_status": job_status or "assigned",
            "live_lat": float(cur_lat) if show_live else None,
            "live_lng": float(cur_lng) if show_live else None,
            "location_updated_at": loc_at.isoformat() if (show_live and loc_at) else None,
        }

    # --- fulfillment cutover (Sprint 3) ---
    async def get_tracking_token(self, job_id: UUID) -> str | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select tracking_token from jobs where id = %s", (str(job_id),)
            )
            row = await cur.fetchone()
        return row[0] if row and row[0] else None

    async def resolve_tracking_token(self, token: str) -> str | None:
        """Resolve a customer capability token to its job id. The token is a
        ~256-bit URL-safe secret looked up via a unique index; an unknown token
        returns None (the route answers 404 — no oracle on token validity)."""
        if not token:
            return None
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select id from jobs where tracking_token = %s", (token,)
            )
            row = await cur.fetchone()
        return str(row[0]) if row else None

    async def get_tracking_by_token(
        self, token: str, *, max_attempts: int, total_timeout_seconds: int
    ) -> dict | None:
        job_id = await self.resolve_tracking_token(token)
        if job_id is None:
            return None
        return await self.get_dispatch_status(
            UUID(job_id), max_attempts=max_attempts, total_timeout_seconds=total_timeout_seconds
        )

    async def get_customer_owner_phone(self, job_id: UUID) -> str | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select o.phone from jobs j"
                " join organizations o on o.id = j.customer_owner_org_id"
                " where j.id = %s",
                (str(job_id),),
            )
            row = await cur.fetchone()
        return row[0] if row else None

    async def get_job_lifecycle(self, job_id: UUID) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select status, fulfillment_technician_id, fulfillment_org_id,"
                " customer_owner_org_id from jobs where id = %s",
                (str(job_id),),
            )
            row = await cur.fetchone()
        if not row:
            return None
        return {
            "status": row[0],
            "fulfillment_technician_id": str(row[1]) if row[1] else None,
            "fulfillment_org_id": str(row[2]) if row[2] else None,
            "customer_owner_org_id": str(row[3]) if row[3] else None,
        }

    async def get_technician_active_job(self, technician_id: UUID) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select j.id, j.status, j.access_type, j.situation, j.address, j.lat, j.lng,"
                " j.detail, t.current_lat, t.current_lng, t.location_updated_at,"
                " m.photo_paths"
                " from jobs j"
                " join technicians t on t.id = j.fulfillment_technician_id"
                " left join lateral ("
                "   select coalesce(array_agg(path order by uploaded_at asc), ARRAY[]::text[]) as photo_paths"
                "   from media"
                "   where owner_type = 'job' and owner_id = j.id and kind = 'intake_photo'"
                " ) m on true"
                " where j.fulfillment_technician_id = %s"
                " and j.status = any(%s)"
                " order by j.updated_at desc limit 1",
                (str(technician_id), ["assigned", "en_route", "arrived", "in_progress", "completed_pending_customer"]),
            )
            row = await cur.fetchone()
        if not row:
            return None
        dist = haversine_km(row[5], row[6], row[8], row[9])
        dist_km = dist if dist != float("inf") else None
        eta_min, eta_max = eta_range_from_km(dist_km)
        return {
            "id": str(row[0]),
            "status": row[1],
            "access_type": row[2],
            "situation": row[3],
            "address": row[4],
            "lat": row[5],
            "lng": row[6],
            "detail": row[7] or {},
            "technician_current_lat": row[8],
            "technician_current_lng": row[9],
            "technician_location_updated_at": row[10].isoformat() if row[10] else None,
            "technician_location_is_fresh": location_is_fresh(
                row[10],
                now=datetime.now(timezone.utc),
                threshold_minutes=config.LOCATION_ONLINE_THRESHOLD_MINUTES,
            ),
            "photo_paths": list(row[11] or []),
            "distance_km": round(dist_km, 2) if dist_km is not None else None,
            "distance_mi": round(dist_km * 0.621371, 2) if dist_km is not None else None,
            "eta_min": eta_min,
            "eta_max": eta_max,
            "eta_is_estimate": True,
        }

    # --- ops-controlled dispatch (Sprint 3.4) ----------------------------------

    async def get_ops_queue(self, org_id: str | None = None) -> list[dict]:
        """Pending_dispatch jobs in arrival order, each annotated with any active
        offer so the dispatcher can see 'Offer sent' state inline. With org_id set,
        scoped to jobs the company owns or fulfills (provider dispatch)."""
        org_filter = ""
        params: tuple = ()
        if org_id is not None:
            org_filter = " and (j.customer_owner_org_id = %s or j.fulfillment_org_id = %s)"
            params = (str(org_id), str(org_id))
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select j.id, j.address, j.lat, j.lng, j.access_type, j.situation,"
                " j.urgency, j.created_at, j.customer_owner_org_id,"
                " j.fulfillment_policy, j.dispatch_attempts, j.detail,"
                " o.id as offer_id, o.technician_id as offered_tech_id, o.expires_at,"
                " d.decline_reason, d.declined_count,"
                " m.photo_count, m.photo_paths"
                " from jobs j"
                " left join dispatch_offers o"
                "   on o.job_id = j.id and o.status = 'offered'"
                " left join lateral ("
                "   select count(*) as declined_count,"
                "     (array_agg(decline_reason order by responded_at desc nulls last))[1]"
                "       as decline_reason"
                "   from dispatch_offers"
                "   where job_id = j.id and status = 'declined'"
                " ) d on true"
                " left join lateral ("
                "   select count(*)::int as photo_count,"
                "     coalesce(array_agg(path order by uploaded_at asc), ARRAY[]::text[]) as photo_paths"
                "   from media"
                "   where owner_type = 'job' and owner_id = j.id and kind = 'intake_photo'"
                " ) m on true"
                " where j.status = 'pending_dispatch'" + org_filter +
                " order by j.created_at asc",
                params,
            )
            rows = await cur.fetchall()
        return [
            {
                "id": str(r[0]),
                "address": r[1],
                "lat": r[2],
                "lng": r[3],
                "access_type": r[4],
                "situation": r[5],
                "urgency": r[6],
                "created_at": r[7].isoformat() if r[7] else None,
                "customer_owner_org_id": str(r[8]) if r[8] else None,
                "fulfillment_policy": r[9],
                "dispatch_attempts": r[10] or 0,
                "detail": r[11] or {},
                "offer_active": r[12] is not None,
                "offer_id": str(r[12]) if r[12] else None,
                "offered_technician_id": str(r[13]) if r[13] else None,
                "offer_expires_at": r[14].isoformat() if r[14] else None,
                "last_decline_reason": r[15],
                "decline_count": r[16] or 0,
                "photo_count": r[17] or 0,
                "photo_paths": list(r[18] or []),
            }
            for r in rows
        ]

    async def list_all_technicians_for_ops(self, org_id: str | None = None) -> list[dict]:
        """Active+verified technicians with location data — no availability filter.
        With org_id set, restricted to the company's dispatch-eligible technicians:
        an active, dispatch-allowed affiliation row (Slice A source of truth), or —
        only when a technician has no affiliation rows yet — the legacy
        primary_organization_id denormalized cache. Otherwise the full platform pool."""
        org_filter = ""
        params: tuple = ()
        if org_id is not None:
            org_filter = (
                " and (exists (select 1 from organization_technicians ot"
                "   where ot.technician_id = technicians.id and ot.organization_id = %s"
                "   and ot.status = 'active' and ot.dispatch_allowed and ot.ended_at is null)"
                " or (primary_organization_id = %s and not exists"
                "   (select 1 from organization_technicians ot2 where ot2.technician_id = technicians.id)))"
            )
            params = (str(org_id), str(org_id))
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select id, display_name, skills, current_lat, current_lng,"
                " service_area_center_lat, service_area_center_lng,"
                " service_area_radius_km, rating, is_available,"
                " location_updated_at, provider_type, primary_organization_id"
                " from technicians"
                " where status = 'active' and vetting_status = 'verified'" + org_filter +
                " order by display_name",
                params,
            )
            rows = await cur.fetchall()
        return [
            {
                "id": str(r[0]),
                "display_name": r[1],
                "skills": list(r[2] or []),
                "current_lat": r[3],
                "current_lng": r[4],
                "service_area_center_lat": r[5],
                "service_area_center_lng": r[6],
                "service_area_radius_km": r[7],
                "rating": float(r[8]) if r[8] is not None else 0.0,
                "is_available": r[9],
                "location_updated_at": r[10].isoformat() if r[10] else None,
                "provider_type": r[11],
                "primary_organization_id": str(r[12]) if r[12] else None,
            }
            for r in rows
        ]

    async def get_fleet_state(self, org_id: str | None = None) -> list[dict]:
        """Technicians with their current location and active job (if any). Single
        LEFT JOIN — one round trip for the fleet map.

        Ops mode (org_id None): all active+verified technicians, unchanged.
        Company mode (org_id set): the company's dispatch-eligible technicians,
        INCLUDING those whose technician profile is no longer active — those are
        surfaced by their LAST KNOWN location only (they must have coordinates).
        Each row carries a derived ``marker_status`` for the map:
          free     — active, available, no active job   (green)
          busy     — has an active job                   (red)
          inactive — not active / unavailable            (yellow, last known)
        """
        active = ["assigned", "en_route", "arrived", "in_progress", "completed_pending_customer"]
        if org_id is None:
            where = " where t.status = 'active' and t.vetting_status = 'verified'"
            params: tuple = (active,)
        else:
            # Affiliation gate (Slice A source of truth) with legacy cache fallback.
            org_filter = (
                " and (exists (select 1 from organization_technicians ot"
                "   where ot.technician_id = t.id and ot.organization_id = %s"
                "   and ot.status = 'active' and ot.dispatch_allowed and ot.ended_at is null)"
                " or (t.primary_organization_id = %s and not exists"
                "   (select 1 from organization_technicians ot2 where ot2.technician_id = t.id)))"
            )
            where = (
                " where t.vetting_status = 'verified'"
                " and (t.status = 'active'"
                "   or (t.current_lat is not null and t.current_lng is not null))"
                + org_filter
            )
            params = (active, str(org_id), str(org_id))
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select t.id, t.display_name, t.skills, t.is_available,"
                " t.current_lat, t.current_lng, t.location_updated_at,"
                " t.status, t.phone,"
                " j.id as job_id, j.status as job_status, j.address as job_address,"
                " j.lat as job_lat, j.lng as job_lng, j.access_type, j.situation"
                " from technicians t"
                " left join jobs j"
                "   on j.fulfillment_technician_id = t.id"
                "   and j.status = any(%s)"
                + where +
                " order by t.display_name",
                params,
            )
            rows = await cur.fetchall()
        out: list[dict] = []
        for r in rows:
            has_job = r[9] is not None
            tech_active = r[7] == "active"
            if has_job:
                marker_status = "busy"
            elif tech_active and r[3]:
                marker_status = "free"
            else:
                marker_status = "inactive"
            out.append({
                "id": str(r[0]),
                "display_name": r[1],
                "skills": list(r[2] or []),
                "is_available": r[3],
                "current_lat": r[4],
                "current_lng": r[5],
                "location_updated_at": r[6].isoformat() if r[6] else None,
                "status": r[7],
                "phone": r[8],
                "marker_status": marker_status,
                "active_job": {
                    "id": str(r[9]),
                    "status": r[10],
                    "address": r[11],
                    "lat": r[12],
                    "lng": r[13],
                    "access_type": r[14],
                    "situation": r[15],
                } if has_job else None,
            })
        return out

    async def decline_dispatch_offer(
        self, offer_id: UUID, technician_id: UUID, reason: str | None = None
    ) -> bool:
        """Mark offer declined (capturing the reason for Ops reassignment); return
        the job to pending_dispatch when no active offer remains."""
        async with await self._connect() as conn:
            cur = await conn.execute(
                "update dispatch_offers"
                " set status = 'declined', responded_at = now(), decline_reason = %s"
                " where id = %s and technician_id = %s and status = 'offered'"
                " returning job_id",
                (reason, str(offer_id), str(technician_id)),
            )
            row = await cur.fetchone()
            if row:
                jid = str(row[0])
                await conn.execute(
                    "update jobs set status = 'pending_dispatch', updated_at = now()"
                    " where id = %s and status = 'pending_dispatch'"
                    "   and not exists ("
                    "     select 1 from dispatch_offers"
                    "     where job_id = %s and status = 'offered')",
                    (jid, jid),
                )
        return row is not None

    async def get_ops_technician(self, technician_id: UUID, org_id: str | None = None) -> dict | None:
        """Fetch one technician only if currently active and verified. With org_id
        set, also require a dispatch-eligible affiliation with that company (active,
        dispatch-allowed, not ended) — falling back to the legacy
        primary_organization_id cache only when no affiliation rows exist."""
        org_filter = ""
        params: tuple = (str(technician_id),)
        if org_id is not None:
            org_filter = (
                " and (exists (select 1 from organization_technicians ot"
                "   where ot.technician_id = technicians.id and ot.organization_id = %s"
                "   and ot.status = 'active' and ot.dispatch_allowed and ot.ended_at is null)"
                " or (primary_organization_id = %s and not exists"
                "   (select 1 from organization_technicians ot2 where ot2.technician_id = technicians.id)))"
            )
            params = (str(technician_id), str(org_id), str(org_id))
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select id, display_name, skills, current_lat, current_lng,"
                " service_area_center_lat, service_area_center_lng,"
                " rating, is_available, location_updated_at, primary_organization_id"
                " from technicians"
                " where id = %s and status = 'active' and vetting_status = 'verified'" + org_filter,
                params,
            )
            row = await cur.fetchone()
        if row is None:
            return None
        return {
            "id": str(row[0]),
            "display_name": row[1],
            "skills": list(row[2] or []),
            "current_lat": row[3],
            "current_lng": row[4],
            "service_area_center_lat": row[5],
            "service_area_center_lng": row[6],
            "rating": float(row[7]) if row[7] is not None else 0.0,
            "is_available": row[8],
            "location_updated_at": row[9].isoformat() if row[9] else None,
            "primary_organization_id": str(row[10]) if row[10] else None,
        }

    async def add_affiliation(
        self, organization_id: UUID, technician_id: UUID, *,
        status: str = "active", affiliation_type: str = "unknown",
        exclusivity: str = "unknown", dispatch_allowed: bool = True,
    ) -> dict:
        """Create (or upsert) a provider affiliation row. The DB partial unique index
        `uq_org_tech_active_exclusive` enforces at most one active EXCLUSIVE affiliation
        per technician; a violation surfaces as ValueError('exclusive_conflict')."""
        try:
            async with await self._connect() as conn:
                await conn.execute(
                    "insert into organization_technicians"
                    " (organization_id, technician_id, role, status, affiliation_type,"
                    "  exclusivity, dispatch_allowed, starts_at, activated_at)"
                    " values (%s, %s, 'affiliate_technician', %s, %s, %s, %s, now(),"
                    "  case when %s = 'active' then now() else null end)"
                    " on conflict (organization_id, technician_id) where ended_at is null"
                    " do update set"
                    "  status = excluded.status, affiliation_type = excluded.affiliation_type,"
                    "  exclusivity = excluded.exclusivity, dispatch_allowed = excluded.dispatch_allowed,"
                    "  ended_reason = null, updated_at = now()",
                    (str(organization_id), str(technician_id), status, affiliation_type,
                     exclusivity, dispatch_allowed, status),
                )
        except Exception as exc:  # unique-violation on the active-exclusive guard
            if "uq_org_tech_active_exclusive" in str(exc):
                raise ValueError("exclusive_conflict") from exc
            raise
        return {
            "organization_id": str(organization_id), "technician_id": str(technician_id),
            "status": status, "affiliation_type": affiliation_type,
            "exclusivity": exclusivity, "dispatch_allowed": dispatch_allowed,
        }

    async def backfill_affiliations_from_primary_org(self) -> int:
        """Create an active, dispatch-allowed affiliation for every technician that has
        a primary_organization_id but no affiliation row for that org yet. Idempotent;
        returns the number of rows inserted. Mirrors migration 0016's backfill."""
        async with await self._connect() as conn:
            cur = await conn.execute(
                "insert into organization_technicians"
                " (organization_id, technician_id, role, status, dispatch_allowed,"
                "  exclusivity, affiliation_type, starts_at, activated_at)"
                " select t.primary_organization_id, t.id, 'affiliate_technician', 'active', true,"
                "  'unknown', 'unknown', now(), now()"
                " from technicians t where t.primary_organization_id is not null"
                " on conflict (organization_id, technician_id) where ended_at is null do nothing",
                (),
            )
            return cur.rowcount or 0

    async def end_affiliation(
        self, organization_id: UUID, technician_id: UUID, *,
        reason: str | None = None, status: str = "ended",
    ) -> dict | None:
        """Close the technician's OPEN affiliation period with this org (leave/remove
        or suspend). `status='ended'` sets `ended_at` so a later rejoin starts a new
        period; `status='suspended'` keeps the period open but dispatch-ineligible."""
        async with await self._connect() as conn:
            cur = await conn.execute(
                "update organization_technicians set status = %s,"
                "  ended_at = case when %s = 'ended' then now() else ended_at end,"
                "  ended_reason = case when %s = 'ended' then %s else ended_reason end,"
                "  suspension_reason = case when %s = 'suspended' then %s else suspension_reason end,"
                "  updated_at = now()"
                " where organization_id = %s and technician_id = %s and ended_at is null"
                " returning id, status, ended_at",
                (status, status, status, reason, status, reason,
                 str(organization_id), str(technician_id)),
            )
            row = await cur.fetchone()
        if row is None:
            return None
        return {"id": str(row[0]), "status": row[1], "ended_at": row[2].isoformat() if row[2] else None}

    # --- technician self-service (Slice D backend) ---
    async def list_technician_affiliations(self, technician_id: UUID) -> list[dict]:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select ot.id, ot.organization_id, o.display_name, ot.status,"
                " ot.affiliation_type, ot.exclusivity, ot.dispatch_allowed, ot.ended_at"
                " from organization_technicians ot"
                " join organizations o on o.id = ot.organization_id"
                " where ot.technician_id = %s"
                " order by ot.ended_at is null desc, ot.starts_at desc",
                (str(technician_id),),
            )
            rows = await cur.fetchall()
        return [
            {
                "id": str(r[0]), "organization_id": str(r[1]), "organization_name": r[2],
                "status": r[3], "affiliation_type": r[4], "exclusivity": r[5],
                "dispatch_allowed": r[6], "ended_at": r[7].isoformat() if r[7] else None,
            }
            for r in rows
        ]

    async def list_technician_organizations(self, technician_id: UUID) -> list[dict]:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select distinct o.id, o.display_name from organization_technicians ot"
                " join organizations o on o.id = ot.organization_id"
                " where ot.technician_id = %s and ot.status = 'active' and ot.ended_at is null"
                " order by o.display_name",
                (str(technician_id),),
            )
            rows = await cur.fetchall()
        return [{"id": str(r[0]), "name": r[1]} for r in rows]

    async def accept_affiliation(self, affiliation_id: UUID, technician_id: UUID) -> dict | None:
        """Activate a self-owned pending invite, enforcing exclusivity at activation:
        no new active affiliation while another provider holds an active exclusive one,
        and an exclusive affiliation cannot activate while other actives exist."""
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select organization_id, status, exclusivity from organization_technicians"
                " where id = %s and technician_id = %s",
                (str(affiliation_id), str(technician_id)),
            )
            row = await cur.fetchone()
            if row is None:
                return None
            org_id, status, exclusivity = row
            if status != "pending_invite":
                raise ValueError("not_pending")
            cur = await conn.execute(
                "select count(*) filter (where exclusivity = 'exclusive'), count(*)"
                " from organization_technicians"
                " where technician_id = %s and status = 'active' and ended_at is null"
                "   and organization_id <> %s",
                (str(technician_id), str(org_id)),
            )
            other_exclusive, other_active = await cur.fetchone()
            if other_exclusive or (exclusivity == "exclusive" and other_active):
                raise ValueError("exclusive_conflict")
            try:
                cur = await conn.execute(
                    "update organization_technicians set status = 'active', activated_at = now(),"
                    "  ended_at = null, ended_reason = null, updated_at = now()"
                    " where id = %s and technician_id = %s"
                    " returning id, organization_id, status, affiliation_type, exclusivity, dispatch_allowed",
                    (str(affiliation_id), str(technician_id)),
                )
                r = await cur.fetchone()
            except Exception as exc:
                if "uq_org_tech_active_exclusive" in str(exc):
                    raise ValueError("exclusive_conflict") from exc
                raise
        return {
            "id": str(r[0]), "organization_id": str(r[1]), "status": r[2],
            "affiliation_type": r[3], "exclusivity": r[4], "dispatch_allowed": r[5],
        }

    async def decline_affiliation(
        self, affiliation_id: UUID, technician_id: UUID, *, reason: str | None = None
    ) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "update organization_technicians set status = 'rejected', ended_at = now(),"
                "  ended_reason = %s, updated_at = now()"
                " where id = %s and technician_id = %s and status = 'pending_invite'"
                " returning id, organization_id, status, ended_at",
                (reason, str(affiliation_id), str(technician_id)),
            )
            row = await cur.fetchone()
        if row is None:
            return None
        return {"id": str(row[0]), "organization_id": str(row[1]), "status": row[2],
                "ended_at": row[3].isoformat() if row[3] else None}

    async def set_technician_photo(self, technician_id: UUID, url: str) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                # Technician self-service photos are auto-approved for now; a real
                # Ops/admin review workflow is deferred (the /admin routes remain).
                "update technicians set profile_photo_url = %s, profile_photo_status = 'approved'"
                " where id = %s returning id",
                (url, str(technician_id)),
            )
            row = await cur.fetchone()
        if row is None:
            return None
        return {"photo_url": url, "photo_status": "approved"}

    async def set_technician_photo_status(self, technician_id: UUID, status: str) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "update technicians set profile_photo_status = %s where id = %s"
                " returning id, profile_photo_url, profile_photo_status",
                (status, str(technician_id)),
            )
            row = await cur.fetchone()
        if row is None:
            return None
        return {"id": str(row[0]), "photo_url": row[1], "photo_status": row[2]}

    async def create_arrival_pin(
        self, job_id: UUID, technician_id: UUID, pin_hash: str,
        expires_at: datetime, max_attempts: int,
    ) -> None:
        async with await self._connect() as conn:
            await conn.execute(
                "insert into arrival_verifications"
                " (job_id, technician_id, pin_hash, expires_at, attempts, max_attempts,"
                "  verified_at, updated_at)"
                " values (%s, %s, %s, %s, 0, %s, null, now())"
                " on conflict (job_id) do update set"
                "   technician_id = excluded.technician_id,"
                "   pin_hash = excluded.pin_hash,"
                "   expires_at = excluded.expires_at,"
                "   attempts = 0, max_attempts = excluded.max_attempts,"
                "   verified_at = null, updated_at = now()",
                (str(job_id), str(technician_id), pin_hash, expires_at, max_attempts),
            )

    async def verify_arrival_pin(
        self, job_id: UUID, technician_id: UUID, pin_hash: str
    ) -> dict:
        async with await self._connect() as conn:
            # Atomic single-use claim: only a correct, live, unlocked PIN bound to
            # this technician flips verified_at — concurrent retries can't double-verify.
            cur = await conn.execute(
                "update arrival_verifications set verified_at = now(), updated_at = now()"
                " where job_id = %s and technician_id = %s and pin_hash = %s"
                "   and verified_at is null and expires_at > now() and attempts < max_attempts"
                " returning job_id",
                (str(job_id), str(technician_id), pin_hash),
            )
            if await cur.fetchone():
                return {"ok": True, "reason": None, "remaining": 0}
            cur = await conn.execute(
                "select technician_id, expires_at, attempts, max_attempts, verified_at"
                " from arrival_verifications where job_id = %s",
                (str(job_id),),
            )
            row = await cur.fetchone()
            if row is None:
                return {"ok": False, "reason": "no_pin", "remaining": 0}
            tech_id, expires_at, attempts, max_attempts, verified_at = row
            remaining = max(0, max_attempts - attempts)
            if verified_at is not None:
                return {"ok": False, "reason": "already_used", "remaining": 0}
            if str(tech_id) != str(technician_id):
                return {"ok": False, "reason": "technician_mismatch", "remaining": remaining}
            if attempts >= max_attempts:
                return {"ok": False, "reason": "locked", "remaining": 0}
            if datetime.now(timezone.utc) > expires_at:
                return {"ok": False, "reason": "expired", "remaining": remaining}
            # Wrong PIN on a live, unlocked record → count the failed attempt.
            cur = await conn.execute(
                "update arrival_verifications set attempts = attempts + 1, updated_at = now()"
                " where job_id = %s and verified_at is null"
                " returning attempts, max_attempts",
                (str(job_id),),
            )
            urow = await cur.fetchone()
            remaining = max(0, urow[1] - urow[0]) if urow else 0
            return {"ok": False, "reason": "locked" if remaining == 0 else "incorrect",
                    "remaining": remaining}

    async def ops_create_single_offer(
        self, job_id: UUID, technician_id: UUID, org_id: UUID | None, expires_at: datetime
    ) -> dict | None:
        """Atomically insert one targeted offer, guarded on the job still being
        pending_dispatch with no technician and no active offer. The INSERT ... SELECT
        is a single round-trip; the partial unique index provides final DB protection.
        Returns {"id": ...} on success, {"error_code": "job_not_pending"} when the job
        is not in the expected state (cancelled / already assigned), or
        {"error_code": "concurrent_offer"} when the unique constraint fires."""
        try:
            async with await self._connect() as conn:
                cur = await conn.execute(
                    "insert into dispatch_offers"
                    " (id, job_id, technician_id, status, rank, offered_at, expires_at, organization_id)"
                    " select gen_random_uuid(), j.id, %s, 'offered', 0, now(), %s, %s"
                    " from jobs j"
                    " where j.id = %s"
                    "   and j.status = 'pending_dispatch'"
                    "   and j.fulfillment_technician_id is null"
                    "   and not exists ("
                    "     select 1 from dispatch_offers"
                    "     where job_id = j.id and status = 'offered')"
                    " returning id",
                    (str(technician_id), expires_at, str(org_id) if org_id else None, str(job_id)),
                )
                row = await cur.fetchone()
            if row:
                return {"id": str(row[0])}
            # Distinguish job-not-pending from concurrent-offer by re-reading job status.
            async with await self._connect() as conn:
                cur = await conn.execute(
                    "select status from jobs where id = %s", (str(job_id),)
                )
                jrow = await cur.fetchone()
            if jrow is None or jrow[0] != "pending_dispatch":
                return {"error_code": "job_not_pending"}
            return {"error_code": "concurrent_offer"}
        except Exception as exc:
            msg = str(exc).lower()
            if "unique" in msg or "duplicate" in msg or "23505" in msg:
                return {"error_code": "concurrent_offer"}
            raise

    async def set_job_status(
        self,
        job_id: UUID,
        new_status: str,
        *,
        expected_current: str | None = None,
        extra_timestamps: list[str] | None = None,
    ) -> dict | None:
        """Optimistic forward status transition. Sets the lifecycle timestamp for
        ``new_status`` (and any ``extra_timestamps``) once. When ``expected_current``
        is given, the UPDATE is guarded on it so concurrent transitions can't race.
        Returns the new row dict, or None if the guard didn't match (conflict)."""
        cols = set(extra_timestamps or [])
        ts = STATUS_TIMESTAMP_COLUMN.get(new_status)
        if ts:
            cols.add(ts)
        # Column names come from a fixed whitelist (STATUS_TIMESTAMP_COLUMN /
        # caller constants), never user input — safe to inline.
        sets = ["status = %s", "updated_at = now()"]
        for col in sorted(cols):
            sets.append(f"{col} = coalesce({col}, now())")
        params: list = [new_status]
        where = "id = %s"
        params.append(str(job_id))
        if expected_current is not None:
            where += " and status = %s"
            params.append(expected_current)
        async with await self._connect() as conn:
            cur = await conn.execute(
                f"update jobs set {', '.join(sets)} where {where} returning id, status",
                tuple(params),
            )
            row = await cur.fetchone()
        if not row:
            return None
        return {"id": str(row[0]), "status": row[1]}

    async def cancel_job(
        self, job_id: UUID, *, current_status: str, reason: str | None = None
    ) -> dict | None:
        """Atomically cancel a job and revoke its outstanding offers in a single
        connection. Guards on ``current_status`` so a concurrent status change
        (e.g. technician transition) is detected and returns None → 409."""
        async with await self._connect() as conn:
            cur = await conn.execute(
                "update jobs set status = %s,"
                " cancelled_at = coalesce(cancelled_at, now()),"
                " closed_at = coalesce(closed_at, now()),"
                " updated_at = now()"
                " where id = %s and status = %s"
                " returning id, status",
                (STATUS_CANCELLED, str(job_id), current_status),
            )
            row = await cur.fetchone()
            if row is None:
                return None
            await conn.execute(
                "update dispatch_offers set status = 'superseded', responded_at = now()"
                " where job_id = %s and status = 'offered'",
                (str(job_id),),
            )
        await self.log_event_raw(
            job_id,
            f"customer_cancel:{reason[:200]}" if reason else "customer_cancel",
        )
        return {"id": str(row[0]), "status": row[1]}

    async def get_provider_active_jobs(self, org_id: str) -> list[dict]:
        """The company's active/recoverable jobs (owned or fulfilled) with assigned
        technician and active-offer state — backs the provider recovery workspace."""
        recoverable = [
            "pending_dispatch", "assigned", "en_route", "arrived", "in_progress",
            "completed_pending_customer", "disputed",
        ]
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select j.id, j.status, j.address, j.access_type, j.situation, j.urgency,"
                " j.created_at, j.fulfillment_technician_id, j.lat, j.lng,"
                " t.display_name, t.location_updated_at,"
                " j.assigned_at, j.en_route_at, j.arrived_at, j.in_progress_at,"
                " j.completed_pending_at, j.disputed_at,"
                " o.id, o.expires_at, i.event"
                " from jobs j"
                " left join technicians t on t.id = j.fulfillment_technician_id"
                " left join dispatch_offers o on o.job_id = j.id and o.status = 'offered'"
                " left join lateral ("
                "   select event from events"
                "   where job_id = j.id and event like 'tech_issue:%%'"
                "   order by at desc limit 1"
                " ) i on true"
                " where (j.customer_owner_org_id = %s or j.fulfillment_org_id = %s)"
                "   and j.status = any(%s)"
                " order by j.created_at asc",
                (str(org_id), str(org_id), recoverable),
            )
            rows = await cur.fetchall()
        out: list[dict] = []
        for r in rows:
            timestamps = {
                "assigned_at": r[12].isoformat() if r[12] else None,
                "en_route_at": r[13].isoformat() if r[13] else None,
                "arrived_at": r[14].isoformat() if r[14] else None,
                "in_progress_at": r[15].isoformat() if r[15] else None,
                "completed_pending_at": r[16].isoformat() if r[16] else None,
                "disputed_at": r[17].isoformat() if r[17] else None,
            }
            out.append({
                "id": str(r[0]), "status": r[1], "address": r[2], "access_type": r[3],
                "situation": r[4], "urgency": r[5],
                "created_at": r[6].isoformat() if r[6] else None,
                "fulfillment_technician_id": str(r[7]) if r[7] else None,
                "lat": r[8],
                "lng": r[9],
                "technician_display_name": r[10],
                "technician_location_updated_at": r[11].isoformat() if r[11] else None,
                "active_status_started_at": _active_status_started_at(r[1], timestamps),
                "offer_active": r[18] is not None,
                "offer_id": str(r[18]) if r[18] else None,
                "offer_expires_at": r[19].isoformat() if r[19] else None,
                "last_issue": r[20],
            })
        return out

    async def list_job_events(self, job_id: UUID) -> list[dict]:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select event, at from events where job_id = %s order by at asc, id asc",
                (str(job_id),),
            )
            rows = await cur.fetchall()
        return [{"event": r[0], "at": r[1].isoformat() if r[1] else None} for r in rows]

    async def list_org_events(self, org_id: str, *, limit: int = 200) -> list[dict]:
        """Recent audit events across the org's jobs (owned or fulfilled), newest
        first — backs the provider org-wide audit log. Tenant-scoped at the join."""
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select e.job_id, e.event, e.at, j.address"
                " from events e"
                " join jobs j on j.id = e.job_id"
                " where j.customer_owner_org_id = %s or j.fulfillment_org_id = %s"
                " order by e.at desc, e.id desc"
                " limit %s",
                (str(org_id), str(org_id), int(limit)),
            )
            rows = await cur.fetchall()
        return [
            {"job_id": str(r[0]), "event": r[1], "at": r[2].isoformat() if r[2] else None, "address": r[3]}
            for r in rows
        ]

    async def recover_job(
        self, job_id: UUID, *, target_status: str, expected_statuses: list[str],
        clear_technician: bool = False, reason: str | None = None, audit_label: str = "recover",
    ) -> dict | None:
        """Atomic tenant recovery transition: guards on current status ∈
        expected_statuses (concurrent change → None → 409), optionally clears the
        assigned technician (revoking their access), and supersedes any active offer."""
        async with await self._connect() as conn:
            cur = await conn.execute(
                "update jobs set status = %s,"
                " fulfillment_technician_id = case when %s then null else fulfillment_technician_id end,"
                " cancelled_at = case when %s = 'cancelled' then coalesce(cancelled_at, now()) else cancelled_at end,"
                " updated_at = now()"
                " where id = %s and status = any(%s)"
                " returning id, status",
                (target_status, clear_technician, target_status, str(job_id), expected_statuses),
            )
            row = await cur.fetchone()
            if row is None:
                return None
            await conn.execute(
                "update dispatch_offers set status = 'superseded', responded_at = now()"
                " where job_id = %s and status = 'offered'",
                (str(job_id),),
            )
        await self.log_event_raw(job_id, f"{audit_label}:{(reason or '')[:200]}")
        return {"id": str(row[0]), "status": row[1]}

    async def add_job_note(
        self, job_id: UUID, *, author_id: str, author_name: str | None, body: str
    ) -> dict:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "insert into job_notes (job_id, author_id, author_name, body)"
                " values (%s, %s, %s, %s)"
                " returning id, author_id, author_name, body, created_at",
                (str(job_id), str(author_id), author_name, body),
            )
            r = await cur.fetchone()
        return {
            "id": str(r[0]), "author_id": str(r[1]), "author_name": r[2],
            "body": r[3], "created_at": r[4].isoformat() if r[4] else None,
        }

    async def list_job_notes(self, job_id: UUID) -> list[dict]:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select id, author_id, author_name, body, created_at from job_notes"
                " where job_id = %s order by created_at asc",
                (str(job_id),),
            )
            rows = await cur.fetchall()
        return [
            {
                "id": str(r[0]), "author_id": str(r[1]), "author_name": r[2],
                "body": r[3], "created_at": r[4].isoformat() if r[4] else None,
            }
            for r in rows
        ]

    async def record_customer_review(
        self,
        *,
        job_id: UUID,
        rating: int,
        comment: str | None,
        issue_reported: bool = False,
        imply_confirm: bool = False,
    ) -> dict:
        """Ticket-scoped, customer-safe review via the token link. Pulls the
        assigned technician / fulfillment + customer-owner orgs from the job (the
        customer may only review the tech assigned to *that* ticket) and refreshes
        rating summaries. Optionally implies confirm (sets confirmed_at)."""
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select fulfillment_technician_id, fulfillment_org_id, customer_owner_org_id"
                " from jobs where id = %s",
                (str(job_id),),
            )
            row = await cur.fetchone()
            if not row:
                raise KeyError(str(job_id))
            tech_ref = str(row[0]) if row[0] else None
            fulfillment_org_id = row[1]
            customer_owner_org_id = row[2]
            confirmed_at = datetime.now(timezone.utc) if imply_confirm else None
            cur = await conn.execute(
                "insert into job_reviews ("
                " job_id, rating, tags, comment, fulfillment_technician_ref, fulfillment_org_id,"
                " assigned_technician_id, customer_owner_org_id, confirmed_at, issue_reported"
                ") values (%s, %s, '{}', %s, %s, %s, %s, %s, %s, %s)"
                " returning id, created_at",
                (
                    str(job_id), rating, comment, tech_ref, fulfillment_org_id,
                    tech_ref, customer_owner_org_id, confirmed_at, issue_reported,
                ),
            )
            review_row = await cur.fetchone()
            targets = []
            if tech_ref:
                targets.append(("technician", tech_ref))
            if fulfillment_org_id:
                targets.append(("organization", str(fulfillment_org_id)))
            for target_type, target_id in targets:
                await conn.execute(
                    "insert into rating_summaries (target_type, target_id, average_rating, review_count)"
                    " select %s, %s, avg(rating)::numeric(3,2), count(*)::integer"
                    " from job_reviews"
                    " where (%s = 'technician' and fulfillment_technician_ref = %s)"
                    "    or (%s = 'organization' and fulfillment_org_id::text = %s)"
                    " on conflict (target_type, target_id) do update set"
                    "  average_rating = excluded.average_rating,"
                    "  review_count = excluded.review_count,"
                    "  updated_at = now()",
                    (target_type, target_id, target_type, target_id, target_type, target_id),
                )
            if tech_ref:
                await conn.execute(
                    "update technicians t set rating = s.average_rating"
                    " from rating_summaries s"
                    " where s.target_type = 'technician' and s.target_id = %s"
                    " and t.id::text = s.target_id",
                    (tech_ref,),
                )
        return {
            "id": str(review_row[0]) if review_row else None,
            "ticket_id": str(job_id),
            "rating": rating,
            "comment": comment,
            "issue_reported": issue_reported,
            "technician_ref": tech_ref,
            "organization_id": str(fulfillment_org_id) if fulfillment_org_id else None,
        }

    # --- payment reconciliation (job history) ----------------------------------

    async def record_payment_report(
        self, *, job_id: UUID, reported_by: str, amount: float, method: str,
        currency: str = "USD",
    ) -> dict:
        """Upsert the latest payment report from one side (technician or customer)
        for a job. One row per (job_id, reported_by) — a re-report overwrites."""
        async with await self._connect() as conn:
            cur = await conn.execute(
                "insert into job_payment_reports"
                " (job_id, reported_by, amount, currency, method)"
                " values (%s, %s, %s, %s, %s)"
                " on conflict (job_id, reported_by) do update set"
                "   amount = excluded.amount, currency = excluded.currency,"
                "   method = excluded.method, reported_at = now(), updated_at = now()"
                " returning amount, currency, method, reported_at",
                (str(job_id), reported_by, round(float(amount), 2), currency, method),
            )
            row = await cur.fetchone()
        return {
            "job_id": str(job_id), "reported_by": reported_by,
            "amount": float(row[0]), "currency": row[1], "method": row[2],
            "reported_at": row[3].isoformat() if row[3] else None,
        }

    async def record_job_closeout(self, closeout: dict) -> dict:
        from psycopg.types.json import Jsonb

        job_id = str(closeout["job_id"])
        async with await self._connect() as conn:
            cur = await conn.execute(
                "insert into job_closeout_reports"
                " (job_id, reported_by, currency, method, subtotal_cents,"
                "  taxable_subtotal_cents, tax_rate_basis_points, tax_cents,"
                "  tip_cents, card_fee_basis_points, card_fee_fixed_cents,"
                "  card_fee_cents, total_cents, no_tax_reason, settings_snapshot)"
                " values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
                " on conflict (job_id, reported_by) do update set"
                "   currency = excluded.currency, method = excluded.method,"
                "   subtotal_cents = excluded.subtotal_cents,"
                "   taxable_subtotal_cents = excluded.taxable_subtotal_cents,"
                "   tax_rate_basis_points = excluded.tax_rate_basis_points,"
                "   tax_cents = excluded.tax_cents, tip_cents = excluded.tip_cents,"
                "   card_fee_basis_points = excluded.card_fee_basis_points,"
                "   card_fee_fixed_cents = excluded.card_fee_fixed_cents,"
                "   card_fee_cents = excluded.card_fee_cents,"
                "   total_cents = excluded.total_cents,"
                "   no_tax_reason = excluded.no_tax_reason,"
                "   settings_snapshot = excluded.settings_snapshot,"
                "   reported_at = now(), updated_at = now()"
                " returning id",
                (
                    job_id,
                    closeout.get("reported_by", "technician"),
                    closeout.get("currency", "USD"),
                    closeout["method"],
                    closeout["subtotal_cents"],
                    closeout["taxable_subtotal_cents"],
                    closeout["tax_rate_basis_points"],
                    closeout["tax_cents"],
                    closeout["tip_cents"],
                    closeout["card_fee_basis_points"],
                    closeout["card_fee_fixed_cents"],
                    closeout["card_fee_cents"],
                    closeout["total_cents"],
                    closeout.get("no_tax_reason"),
                    Jsonb(closeout.get("settings_snapshot") or {}),
                ),
            )
            row = await cur.fetchone()
            closeout_id = row[0]
            await conn.execute("delete from job_closeout_line_items where closeout_id = %s", (closeout_id,))
            for item in closeout.get("line_items", []):
                await conn.execute(
                    "insert into job_closeout_line_items"
                    " (closeout_id, job_id, line_number, item_type_code, description,"
                    "  quantity, unit_amount_cents, line_total_cents, taxable,"
                    "  provided_by, compensation_eligible, reimbursement_eligible, note)"
                    " values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    (
                        closeout_id,
                        job_id,
                        item["line_number"],
                        item["item_type_code"],
                        item["description"],
                        item["quantity"],
                        item["unit_amount_cents"],
                        item["line_total_cents"],
                        item["taxable"],
                        item.get("provided_by"),
                        item.get("compensation_eligible", False),
                        item.get("reimbursement_eligible", False),
                        item.get("note"),
                    ),
                )
        saved = await self.get_job_closeout(UUID(job_id))
        return saved or closeout

    @staticmethod
    def _closeout_report_row(row: tuple, line_items: list[dict]) -> dict:
        return {
            "id": str(row[0]),
            "job_id": str(row[1]),
            "reported_by": row[2],
            "currency": row[3],
            "method": row[4],
            "subtotal_cents": row[5],
            "taxable_subtotal_cents": row[6],
            "tax_rate_basis_points": row[7],
            "tax_cents": row[8],
            "tip_cents": row[9],
            "card_fee_basis_points": row[10],
            "card_fee_fixed_cents": row[11],
            "card_fee_cents": row[12],
            "total_cents": row[13],
            "no_tax_reason": row[14],
            "settings_snapshot": row[15] or {},
            "reported_at": row[16].isoformat() if row[16] else None,
            "updated_at": row[17].isoformat() if row[17] else None,
            "line_items": line_items,
        }

    @staticmethod
    def _closeout_line_row(row: tuple) -> dict:
        return {
            "line_number": row[0],
            "item_type_code": row[1],
            "description": row[2],
            "quantity": float(row[3]),
            "unit_amount_cents": row[4],
            "line_total_cents": row[5],
            "taxable": row[6],
            "provided_by": row[7],
            "compensation_eligible": row[8],
            "reimbursement_eligible": row[9],
            "note": row[10],
        }

    async def get_job_closeout(self, job_id: UUID) -> dict | None:
        async with await self._connect() as conn:
            reports = await self._closeouts_for(conn, [str(job_id)])
        return reports.get(str(job_id))

    async def _closeouts_for(self, conn, job_ids: list[str]) -> dict[str, dict]:
        if not job_ids:
            return {}
        cur = await conn.execute(
            "select id, job_id, reported_by, currency, method, subtotal_cents,"
            " taxable_subtotal_cents, tax_rate_basis_points, tax_cents, tip_cents,"
            " card_fee_basis_points, card_fee_fixed_cents, card_fee_cents,"
            " total_cents, no_tax_reason, settings_snapshot, reported_at, updated_at"
            " from job_closeout_reports"
            " where job_id = any(%s) and reported_by = 'technician'",
            (job_ids,),
        )
        rows = await cur.fetchall()
        if not rows:
            return {}
        closeout_ids = [str(r[0]) for r in rows]
        line_cur = await conn.execute(
            "select closeout_id, line_number, item_type_code, description, quantity,"
            " unit_amount_cents, line_total_cents, taxable, provided_by,"
            " compensation_eligible, reimbursement_eligible, note"
            " from job_closeout_line_items"
            " where closeout_id = any(%s)"
            " order by closeout_id, line_number",
            (closeout_ids,),
        )
        lines: dict[str, list[dict]] = {cid: [] for cid in closeout_ids}
        for line in await line_cur.fetchall():
            lines[str(line[0])].append(self._closeout_line_row(line[1:]))
        return {
            str(row[1]): self._closeout_report_row(row, lines.get(str(row[0]), []))
            for row in rows
        }

    async def _payments_for(self, conn, job_ids: list[str]) -> dict[str, dict]:
        """job_id -> {'technician': {...}|None, 'customer': {...}|None}."""
        out: dict[str, dict] = {jid: {"technician": None, "customer": None} for jid in job_ids}
        if not job_ids:
            return out
        cur = await conn.execute(
            "select job_id, reported_by, amount, currency, method, reported_at"
            " from job_payment_reports where job_id = any(%s)",
            (job_ids,),
        )
        for r in await cur.fetchall():
            out[str(r[0])][r[1]] = {
                "amount": float(r[2]), "currency": r[3], "method": r[4],
                "reported_at": r[5].isoformat() if r[5] else None,
            }
        return out

    async def get_payment_reports(self, job_id: UUID) -> dict:
        async with await self._connect() as conn:
            reports = await self._payments_for(conn, [str(job_id)])
        return reports[str(job_id)]

    async def get_job_review(self, job_id: UUID) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select rating, comment, issue_reported, created_at from job_reviews"
                " where job_id = %s order by created_at desc limit 1",
                (str(job_id),),
            )
            row = await cur.fetchone()
        if not row:
            return None
        return {
            "rating": row[0], "comment": row[1], "issue_reported": row[2],
            "created_at": row[3].isoformat() if row[3] else None,
        }

    async def _job_history(
        self, where: str, params: tuple, limit: int, statuses=HISTORY_STATUSES, *, offset: int = 0
    ) -> list[dict]:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select j.id, j.status, j.address, j.situation, j.urgency, j.created_at,"
                " coalesce(j.confirmed_at, j.closed_at, j.cancelled_at, j.disputed_at, j.updated_at),"
                " j.fulfillment_technician_id, t.display_name, j.access_type,"
                " j.fulfillment_org_id, j.customer_owner_org_id,"
                " r.rating, r.comment, r.created_at"
                " from jobs j"
                " left join technicians t on t.id = j.fulfillment_technician_id"
                " left join lateral ("
                "   select rating, comment, created_at from job_reviews"
                "   where job_id = j.id order by created_at desc limit 1"
                " ) r on true"
                " where " + where + " and j.status = any(%s)"
                " order by 7 desc nulls last, j.id limit %s offset %s",
                params + (list(statuses), limit, offset),
            )
            rows = await cur.fetchall()
            job_ids = [str(r[0]) for r in rows]
            payments = await self._payments_for(conn, job_ids)
            closeouts = await self._closeouts_for(conn, job_ids)
        return [
            {
                "id": str(r[0]), "status": r[1], "address": r[2], "situation": r[3],
                "urgency": r[4],
                "created_at": r[5].isoformat() if r[5] else None,
                "finished_at": r[6].isoformat() if r[6] else None,
                "fulfillment_technician_id": str(r[7]) if r[7] else None,
                "technician_display_name": r[8],
                "access_type": r[9],
                "fulfillment_org_id": str(r[10]) if r[10] else None,
                "customer_owner_org_id": str(r[11]) if r[11] else None,
                "review": (
                    {"rating": r[12], "comment": r[13],
                     "created_at": r[14].isoformat() if r[14] else None}
                    if r[12] is not None else None
                ),
                "payments": payments.get(str(r[0]), {"technician": None, "customer": None}),
                "closeout": closeouts.get(str(r[0])),
            }
            for r in rows
        ]

    async def get_provider_job_history(self, org_id: str, *, limit: int = 100, offset: int = 0) -> list[dict]:
        return await self._job_history(
            "(j.customer_owner_org_id = %s or j.fulfillment_org_id = %s)",
            (str(org_id), str(org_id)), limit, offset=offset,
        )

    _FINANCIAL_OVERVIEW_PAGE_SIZE = 1000

    async def _all_provider_job_history(self, org_id: str) -> list[dict]:
        """Every job in the org's history, unbounded -- paginated internally so a
        single dashboard aggregation never silently truncates at a page size."""
        page_size = self._FINANCIAL_OVERVIEW_PAGE_SIZE
        out: list[dict] = []
        offset = 0
        while True:
            page = await self.get_provider_job_history(org_id, limit=page_size, offset=offset)
            out.extend(page)
            if len(page) < page_size:
                return out
            offset += page_size

    async def _all_settlement_payments(self, org_id: str) -> list[dict]:
        page_size = self._FINANCIAL_OVERVIEW_PAGE_SIZE
        out: list[dict] = []
        offset = 0
        while True:
            page = await self.list_settlement_payments(org_id, limit=page_size, offset=offset)
            out.extend(page)
            if len(page) < page_size:
                return out
            offset += page_size

    async def _all_settlement_periods(self, org_id: str) -> list[dict]:
        page_size = self._FINANCIAL_OVERVIEW_PAGE_SIZE
        out: list[dict] = []
        offset = 0
        while True:
            page = await self.list_provider_settlement_periods(org_id, limit=page_size, offset=offset)
            out.extend(page)
            if len(page) < page_size:
                return out
            offset += page_size

    async def _settlement_rows_from_history(self, org_id: str, job_rows: list[dict]) -> list[dict]:
        """Job-history rows -> settlement rows (agreement-applied, affiliation-stamped),
        with no period/technician filtering. Shared by list_provider_settlements (which
        filters afterward) and the financial overview (which needs the unfiltered set).
        Agreement lookups are cached per technician within the call -- one lookup per
        distinct technician, not per job, however many rows are being processed."""
        agreements: dict[str, tuple[dict | None, bool, str | None]] = {}
        out = []
        for row in job_rows:
            tech_id = row.get("fulfillment_technician_id")
            if not tech_id or not row.get("closeout"):
                continue
            key = str(tech_id)
            if key not in agreements:
                agreements[key] = await self.get_provider_technician_agreement_for_reporting(
                    UUID(str(org_id)), UUID(key)
                )
            agreement, affiliation_ended, affiliation_ended_at = agreements[key]
            settlement = calculate_settlement(row, agreement)
            settlement["affiliation_ended"] = affiliation_ended
            settlement["affiliation_ended_at"] = affiliation_ended_at
            out.append(settlement)
        return out

    async def list_provider_settlements(
        self, org_id: str, *, technician_id: str | None = None,
        period_start: str | None = None, period_end: str | None = None,
        limit: int = 100,
    ) -> list[dict]:
        rows = await self.get_provider_job_history(org_id, limit=limit)
        settlements = await self._settlement_rows_from_history(org_id, rows)
        filters = {"technician_id": technician_id, "period_start": period_start, "period_end": period_end}
        return [s for s in settlements if _settlement_row_in_period(s, filters)]

    async def get_provider_financial_overview(
        self, org_id: str, *, period_start: str | None = None, period_end: str | None = None
    ) -> dict:
        job_rows = await self._all_provider_job_history(org_id)
        all_time_rows = await self._settlement_rows_from_history(org_id, job_rows)
        period_filter = {"technician_id": None, "period_start": period_start, "period_end": period_end}
        period_rows = [r for r in all_time_rows if _settlement_row_in_period(r, period_filter)]
        payments = await self._all_settlement_payments(org_id)
        periods = await self._all_settlement_periods(org_id)
        skill_labels = await _skill_label_map(self)
        item_labels = await _item_type_label_map(self)
        return build_financial_overview(
            all_time_rows, period_rows, payments, periods,
            period_start=period_start, period_end=period_end,
            skill_labels=skill_labels, item_labels=item_labels,
        )

    async def list_technician_settlements(self, technician_id: UUID, *, limit: int = 100) -> dict:
        live = []
        for row in await self.get_technician_job_history(technician_id, limit=limit):
            org_id = row.get("fulfillment_org_id") or row.get("customer_owner_org_id")
            if not org_id or not row.get("closeout"):
                continue
            agreement = await self.get_provider_technician_agreement(UUID(str(org_id)), technician_id)
            settlement = calculate_settlement(row, agreement)
            settlement["organization_id"] = str(org_id)
            live.append(settlement)
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select sp.id, sp.status, sp.label, sp.period_start, sp.period_end,"
                " sp.locked_at, sp.paid_at, spj.row_snapshot"
                " from settlement_period_jobs spj"
                " join settlement_periods sp on sp.id = spj.settlement_period_id"
                " where spj.technician_id = %s"
                " order by sp.created_at desc, spj.created_at desc limit %s",
                (str(technician_id), limit),
            )
            rows = await cur.fetchall()
        period_rows = [
            {
                "settlement_period_id": str(r[0]),
                "status": r[1],
                "label": r[2],
                "period_start": r[3].isoformat() if r[3] else None,
                "period_end": r[4].isoformat() if r[4] else None,
                "locked_at": r[5].isoformat() if r[5] else None,
                "paid_at": r[6].isoformat() if r[6] else None,
                "row": r[7],
            }
            for r in rows
        ]
        return {"live": live, "period_rows": period_rows}

    @staticmethod
    def _period_summary(row: tuple) -> dict:
        return {
            "id": str(row[0]), "organization_id": str(row[1]), "status": row[2], "label": row[3],
            "period_start": row[4].isoformat() if row[4] else None,
            "period_end": row[5].isoformat() if row[5] else None,
            "technician_id": str(row[6]) if row[6] else None,
            "job_count": row[7], "customer_total_cents": row[8], "tax_cents": row[9],
            "card_fee_cents": row[10], "tech_payout_cents": row[11],
            "company_retained_cents": row[12], "adjustment_cents": row[13],
            "final_tech_payout_cents": row[14], "note": row[15],
            "created_by": str(row[16]) if row[16] else None,
            "locked_by": str(row[17]) if row[17] else None,
            "paid_by": str(row[18]) if row[18] else None,
            "created_at": row[19].isoformat() if row[19] else None,
            "updated_at": row[20].isoformat() if row[20] else None,
            "locked_at": row[21].isoformat() if row[21] else None,
            "paid_at": row[22].isoformat() if row[22] else None,
        }

    async def _refresh_settlement_period_totals(self, conn, period_id: str) -> None:
        await conn.execute(
            "update settlement_periods sp set job_count = coalesce(j.job_count, 0),"
            " customer_total_cents = coalesce(j.customer_total_cents, 0),"
            " tax_cents = coalesce(j.tax_cents, 0), card_fee_cents = coalesce(j.card_fee_cents, 0),"
            " tech_payout_cents = coalesce(j.tech_payout_cents, 0),"
            " company_retained_cents = coalesce(j.company_retained_cents, 0),"
            " adjustment_cents = coalesce(a.adjustment_cents, 0),"
            " final_tech_payout_cents = coalesce(j.tech_payout_cents, 0) + coalesce(a.adjustment_cents, 0),"
            " updated_at = now()"
            " from (select count(*)::int job_count,"
            " coalesce(sum((row_snapshot->>'customer_total_cents')::int),0)::int customer_total_cents,"
            " coalesce(sum((row_snapshot->>'tax_cents')::int),0)::int tax_cents,"
            " coalesce(sum((row_snapshot->>'card_fee_cents')::int),0)::int card_fee_cents,"
            " coalesce(sum(tech_payout_cents),0)::int tech_payout_cents,"
            " coalesce(sum(company_retained_cents),0)::int company_retained_cents"
            " from settlement_period_jobs where settlement_period_id = %s) j,"
            " (select coalesce(sum(amount_cents),0)::int adjustment_cents"
            " from settlement_adjustments where settlement_period_id = %s) a where sp.id = %s",
            (period_id, period_id, period_id),
        )

    async def create_provider_settlement_period(self, org_id: str, data: dict, *, created_by: str | None = None) -> dict:
        from psycopg.types.json import Jsonb
        candidate_rows = [row for row in await self.list_provider_settlements(org_id, limit=1000) if _settlement_row_in_period(row, data)]
        async with await self._connect() as conn:
            # ponytail: app-level dedup, not a DB constraint -- a race between two
            # concurrent creates could still double-assign a job. Add a unique
            # index on (organization_id, job_id) if that ever shows up in practice.
            cur = await conn.execute(
                "select spj.job_id from settlement_period_jobs spj"
                " join settlement_periods sp on sp.id = spj.settlement_period_id"
                " where sp.organization_id = %s",
                (str(org_id),),
            )
            already_settled = {str(r[0]) for r in await cur.fetchall()}
            rows = [row for row in candidate_rows if str(row["job_id"]) not in already_settled]
            cur = await conn.execute(
                "insert into settlement_periods (organization_id, label, period_start, period_end, technician_id, note, created_by)"
                " values (%s, %s, %s, %s, %s, %s, %s) returning id",
                (str(org_id), data.get("label") or f"Settlement {data.get('period_start') or ''} – {data.get('period_end') or ''}".strip(),
                 data.get("period_start"), data.get("period_end"), data.get("technician_id"), data.get("note"), str(created_by) if created_by else None),
            )
            period_id = str((await cur.fetchone())[0])
            for row in rows:
                await conn.execute(
                    "insert into settlement_period_jobs (settlement_period_id, job_id, technician_id, row_snapshot, tech_payout_cents, company_retained_cents)"
                    " values (%s, %s, %s, %s, %s, %s) on conflict (settlement_period_id, job_id) do nothing",
                    (period_id, row["job_id"], row.get("technician_id"), Jsonb(row), row.get("tech_payout_cents") or 0, row.get("company_retained_cents") or 0),
                )
            await self._refresh_settlement_period_totals(conn, period_id)
        return await self.get_provider_settlement_period(org_id, UUID(period_id)) or {}

    async def list_provider_settlement_periods(self, org_id: str, *, limit: int = 50, offset: int = 0) -> list[dict]:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select id, organization_id, status, label, period_start, period_end, technician_id,"
                " job_count, customer_total_cents, tax_cents, card_fee_cents, tech_payout_cents,"
                " company_retained_cents, adjustment_cents, final_tech_payout_cents, note,"
                " created_by, locked_by, paid_by, created_at, updated_at, locked_at, paid_at"
                " from settlement_periods where organization_id = %s order by created_at desc, id limit %s offset %s",
                (str(org_id), limit, offset),
            )
            rows = await cur.fetchall()
        return [self._period_summary(row) for row in rows]

    async def get_provider_settlement_period(self, org_id: str, period_id: UUID) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select id, organization_id, status, label, period_start, period_end, technician_id,"
                " job_count, customer_total_cents, tax_cents, card_fee_cents, tech_payout_cents,"
                " company_retained_cents, adjustment_cents, final_tech_payout_cents, note,"
                " created_by, locked_by, paid_by, created_at, updated_at, locked_at, paid_at"
                " from settlement_periods where id = %s and organization_id = %s",
                (str(period_id), str(org_id)),
            )
            row = await cur.fetchone()
            if not row:
                return None
            period = self._period_summary(row)
            cur = await conn.execute("select row_snapshot from settlement_period_jobs where settlement_period_id = %s order by created_at, job_id", (str(period_id),))
            period["rows"] = [r[0] for r in await cur.fetchall()]
            cur = await conn.execute("select id, amount_cents, reason, created_by, created_at from settlement_adjustments where settlement_period_id = %s order by created_at", (str(period_id),))
            period["adjustments"] = [{"id": str(r[0]), "amount_cents": r[1], "reason": r[2], "created_by": str(r[3]) if r[3] else None, "created_at": r[4].isoformat() if r[4] else None} for r in await cur.fetchall()]
        return period

    async def lock_provider_settlement_period(self, org_id: str, period_id: UUID, *, actor_id: str | None = None, note: str | None = None) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "update settlement_periods set status = 'locked', locked_at = now(), locked_by = %s, note = coalesce(%s, note), updated_at = now()"
                " where id = %s and organization_id = %s and status = 'draft' returning id",
                (str(actor_id) if actor_id else None, note, str(period_id), str(org_id)),
            )
            if not await cur.fetchone():
                if await self.get_provider_settlement_period(org_id, period_id) is None:
                    return None
                raise ValueError("invalid_status")
        return await self.get_provider_settlement_period(org_id, period_id)

    async def mark_provider_settlement_period_paid(self, org_id: str, period_id: UUID, *, actor_id: str | None = None, note: str | None = None) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "update settlement_periods set status = 'paid', paid_at = now(), paid_by = %s, note = coalesce(%s, note), updated_at = now()"
                " where id = %s and organization_id = %s and status = 'locked' returning id",
                (str(actor_id) if actor_id else None, note, str(period_id), str(org_id)),
            )
            if not await cur.fetchone():
                if await self.get_provider_settlement_period(org_id, period_id) is None:
                    return None
                raise ValueError("invalid_status")
        return await self.get_provider_settlement_period(org_id, period_id)

    async def add_provider_settlement_adjustment(self, org_id: str, period_id: UUID, data: dict, *, actor_id: str | None = None) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute("select status from settlement_periods where id = %s and organization_id = %s", (str(period_id), str(org_id)))
            row = await cur.fetchone()
            if not row:
                return None
            if row[0] != "draft":
                raise ValueError("invalid_status")
            await conn.execute(
                "insert into settlement_adjustments (settlement_period_id, amount_cents, reason, created_by) values (%s, %s, %s, %s)",
                (str(period_id), int(data.get("amount_cents") or 0), data["reason"], str(actor_id) if actor_id else None),
            )
            await self._refresh_settlement_period_totals(conn, str(period_id))
        return await self.get_provider_settlement_period(org_id, period_id)

    _SETTLEMENT_PAYMENT_COLUMNS = (
        "sp.id, sp.organization_id, sp.technician_id, t.display_name,"
        " sp.settlement_period_id, sp.source_period_start, sp.source_period_end,"
        " sp.direction, sp.amount_cents, sp.payment_method, sp.reference_number,"
        " sp.paid_on, sp.note, sp.status, sp.submitted_by_role, sp.submitted_by,"
        " sp.confirmed_by, sp.confirmed_at, sp.rejected_by, sp.rejected_at, sp.rejected_reason,"
        " sp.voided_by, sp.voided_at, sp.void_reason, sp.created_at, sp.updated_at"
    )

    @staticmethod
    def _settlement_payment_row(r: tuple) -> dict:
        def _iso(value):
            return value.isoformat() if value else None
        return {
            "id": str(r[0]), "organization_id": str(r[1]), "technician_id": str(r[2]),
            "technician_display_name": r[3],
            "settlement_period_id": str(r[4]) if r[4] else None,
            "source_period_start": _iso(r[5]), "source_period_end": _iso(r[6]),
            "direction": r[7], "amount_cents": r[8], "payment_method": r[9],
            "reference_number": r[10], "paid_on": _iso(r[11]), "note": r[12],
            "status": r[13], "submitted_by_role": r[14],
            "submitted_by": str(r[15]) if r[15] else None,
            "confirmed_by": str(r[16]) if r[16] else None, "confirmed_at": _iso(r[17]),
            "rejected_by": str(r[18]) if r[18] else None, "rejected_at": _iso(r[19]),
            "rejected_reason": r[20],
            "voided_by": str(r[21]) if r[21] else None, "voided_at": _iso(r[22]),
            "void_reason": r[23], "created_at": _iso(r[24]), "updated_at": _iso(r[25]),
        }

    async def _fetch_settlement_payment(self, conn, org_id: str, payment_id: UUID) -> dict | None:
        cur = await conn.execute(
            f"select {self._SETTLEMENT_PAYMENT_COLUMNS} from settlement_payments sp"
            " left join technicians t on t.id = sp.technician_id"
            " where sp.id = %s and sp.organization_id = %s",
            (str(payment_id), str(org_id)),
        )
        row = await cur.fetchone()
        return self._settlement_payment_row(row) if row else None

    async def create_settlement_payment(
        self, org_id: str, data: dict, *, submitted_by: str | None,
        submitted_by_role: str, status: str,
    ) -> dict:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "insert into settlement_payments (organization_id, technician_id, settlement_period_id,"
                " source_period_start, source_period_end, direction, amount_cents, payment_method,"
                " reference_number, paid_on, note, status, submitted_by_role, submitted_by,"
                " confirmed_by, confirmed_at)"
                " values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,"
                " case when %s = 'confirmed' then now() end) returning id",
                (
                    str(org_id), str(data["technician_id"]), data.get("settlement_period_id"),
                    data.get("source_period_start"), data.get("source_period_end"),
                    data["direction"], int(data["amount_cents"]), data["payment_method"],
                    data.get("reference_number"), data["paid_on"], data.get("note"),
                    status, submitted_by_role, str(submitted_by) if submitted_by else None,
                    str(submitted_by) if submitted_by and status == "confirmed" else None,
                    status,
                ),
            )
            payment_id = (await cur.fetchone())[0]
            payment = await self._fetch_settlement_payment(conn, org_id, payment_id)
        return payment or {}

    async def list_settlement_payments(
        self, org_id: str, *, technician_id: str | None = None,
        status: str | None = None, period_start: str | None = None,
        period_end: str | None = None, limit: int = 500, offset: int = 0,
    ) -> list[dict]:
        where = ["sp.organization_id = %s"]
        params: list = [str(org_id)]
        if technician_id:
            where.append("sp.technician_id = %s")
            params.append(str(technician_id))
        if status:
            where.append("sp.status = %s")
            params.append(status)
        if period_start:
            where.append("sp.paid_on >= %s")
            params.append(period_start)
        if period_end:
            where.append("sp.paid_on <= %s")
            params.append(period_end)
        async with await self._connect() as conn:
            cur = await conn.execute(
                f"select {self._SETTLEMENT_PAYMENT_COLUMNS} from settlement_payments sp"
                " left join technicians t on t.id = sp.technician_id"
                " where " + " and ".join(where) +
                " order by sp.paid_on desc, sp.created_at desc, sp.id limit %s offset %s",
                (*params, limit, offset),
            )
            rows = await cur.fetchall()
        return [self._settlement_payment_row(r) for r in rows]

    async def _transition_settlement_payment(
        self, org_id: str, payment_id: UUID, *, from_status: str, set_sql: str, params: tuple
    ) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                f"update settlement_payments set {set_sql}, updated_at = now()"
                " where id = %s and organization_id = %s and status = %s returning id",
                (*params, str(payment_id), str(org_id), from_status),
            )
            if not await cur.fetchone():
                if await self._fetch_settlement_payment(conn, org_id, payment_id) is None:
                    return None
                raise ValueError("invalid_status")
            payment = await self._fetch_settlement_payment(conn, org_id, payment_id)
        return payment

    async def confirm_settlement_payment(
        self, org_id: str, payment_id: UUID, *, actor_id: str | None = None
    ) -> dict | None:
        return await self._transition_settlement_payment(
            org_id, payment_id, from_status="pending",
            set_sql="status = 'confirmed', confirmed_by = %s, confirmed_at = now()",
            params=(str(actor_id) if actor_id else None,),
        )

    async def reject_settlement_payment(
        self, org_id: str, payment_id: UUID, *, actor_id: str | None = None, reason: str
    ) -> dict | None:
        return await self._transition_settlement_payment(
            org_id, payment_id, from_status="pending",
            set_sql="status = 'rejected', rejected_by = %s, rejected_at = now(), rejected_reason = %s",
            params=(str(actor_id) if actor_id else None, reason),
        )

    async def void_settlement_payment(
        self, org_id: str, payment_id: UUID, *, actor_id: str | None = None, reason: str
    ) -> dict | None:
        return await self._transition_settlement_payment(
            org_id, payment_id, from_status="confirmed",
            set_sql="status = 'voided', voided_by = %s, voided_at = now(), void_reason = %s",
            params=(str(actor_id) if actor_id else None, reason),
        )

    async def list_technician_settlement_payments(
        self, technician_id: UUID, *, limit: int = 200
    ) -> list[dict]:
        async with await self._connect() as conn:
            cur = await conn.execute(
                f"select {self._SETTLEMENT_PAYMENT_COLUMNS}, o.display_name from settlement_payments sp"
                " left join technicians t on t.id = sp.technician_id"
                " left join organizations o on o.id = sp.organization_id"
                " where sp.technician_id = %s"
                " order by sp.paid_on desc, sp.created_at desc limit %s",
                (str(technician_id), limit),
            )
            rows = await cur.fetchall()
        return [
            {**self._settlement_payment_row(r[:-1]), "organization_name": r[-1]}
            for r in rows
        ]

    async def get_technician_job_history(
        self, technician_id: UUID, *, limit: int = 100
    ) -> list[dict]:
        return await self._job_history(
            "j.fulfillment_technician_id = %s", (str(technician_id),), limit,
            statuses=TECHNICIAN_HISTORY_STATUSES,
        )

    async def auto_close_pending(self, window_seconds: int) -> int:
        """Cron-owned: close jobs stuck in completed_pending_customer past the
        confirm window → completed_auto_closed. Returns how many were closed."""
        async with await self._connect() as conn:
            cur = await conn.execute(
                "update jobs set status = %s, closed_at = now(), updated_at = now()"
                " where status = %s and completed_pending_at is not null"
                " and extract(epoch from (now() - completed_pending_at)) >= %s"
                " returning 1",
                (STATUS_COMPLETED_AUTO_CLOSED, STATUS_COMPLETED_PENDING, window_seconds),
            )
            rows = await cur.fetchall()
        return len(rows)

    async def resolve_job(
        self, job_id: UUID, *, action: str, note: str | None = None
    ) -> dict | None:
        """Dispatcher/admin resolution of an in-flight or disputed job. Actions:
        ``close`` (→ completed_auto_closed), ``cancel`` (→ cancelled),
        ``redispatch`` (→ pending_dispatch, clear assignment so the sweep retries)."""
        if action == "close":
            updated = await self.set_job_status(
                job_id, STATUS_COMPLETED_AUTO_CLOSED, extra_timestamps=["closed_at"]
            )
        elif action == "cancel":
            updated = await self.set_job_status(job_id, "cancelled")
        elif action == "redispatch":
            async with await self._connect() as conn:
                cur = await conn.execute(
                    "update jobs set status = %s, trust_state = 'intake',"
                    " fulfillment_technician_id = null, fulfillment_org_id = null,"
                    " assigned_at = null, dispatch_attempts = 0, updated_at = now()"
                    " where id = %s returning id, status",
                    (STATUS_PENDING_DISPATCH, str(job_id)),
                )
                row = await cur.fetchone()
                if row:
                    await conn.execute(
                        "update dispatch_offers set status = 'superseded', responded_at = now()"
                        " where job_id = %s and status = 'offered'",
                        (str(job_id),),
                    )
            updated = {"id": str(row[0]), "status": row[1]} if row else None
        else:
            raise ValueError("unknown_action")
        if updated is None:
            return None
        if note:
            await self.log_event_raw(job_id, f"resolve:{action}:{note[:200]}")
        else:
            await self.log_event_raw(job_id, f"resolve:{action}")
        return updated

    async def log_event_raw(self, job_id: UUID, event: str) -> None:
        async with await self._connect() as conn:
            await conn.execute(
                "insert into events (ticket_id, job_id, event) values (%s, %s, %s)",
                (str(job_id), str(job_id), event),
            )

    async def register_technician(self, data: dict) -> dict:
        email = (data.get("email") or "").strip() or None
        phone = (data.get("phone") or "").strip() or None
        pw_hash = hash_password(data["password"])
        async with await self._connect() as conn:
            if email:
                cur = await conn.execute("select 1 from users where lower(email) = lower(%s)", (email,))
                if await cur.fetchone():
                    raise ValueError("email_taken")
            if phone:
                cur = await conn.execute("select 1 from users where phone = %s", (phone,))
                if await cur.fetchone():
                    raise ValueError("phone_taken")
            cur = await conn.execute(
                "insert into users (email, phone, password_hash, display_name, status, locale)"
                " values (%s, %s, %s, %s, 'active', %s) returning id",
                (email, phone, pw_hash, data["display_name"], data.get("locale")),
            )
            user_id = (await cur.fetchone())[0]
            await conn.execute(
                "insert into user_roles (user_id, role) values (%s, 'technician') on conflict do nothing",
                (user_id,),
            )
            # 1:1 technician-owned profile, same id. Company affiliation is a
            # separate row and is never silently activated by provider signup.
            await conn.execute(
                "insert into technicians (id, display_name, email, phone, status, vetting_status,"
                " skills, service_area_center_lat, service_area_center_lng, service_area_radius_km,"
                " is_available, provider_type)"
                " values (%s, %s, %s, %s, 'pending_vetting', 'unverified', %s, %s, %s, %s, false, 'individual')",
                (
                    user_id, data["display_name"], email, phone, data.get("skills") or [],
                    data.get("service_area_center_lat"), data.get("service_area_center_lng"),
                    data.get("service_area_radius_km"),
                ),
            )
            # Invite-driven signup: attach to the inviting company as a PENDING
            # affiliation. The technician accepts after signup/login; the provider
            # does not approve or own the global technician profile.
            token = (data.get("invite_token") or "").strip() or None
            if token:
                cur = await conn.execute(
                    "select organization_id from technician_invites"
                    " where token = %s and status = 'pending' and expires_at > now()",
                    (token,),
                )
                inv = await cur.fetchone()
                if inv:
                    await conn.execute(
                        "insert into organization_technicians"
                        " (organization_id, technician_id, role, status,"
                        "  affiliation_type, exclusivity, dispatch_allowed, starts_at)"
                        " values (%s, %s, 'affiliate_technician', 'pending_invite',"
                        "  'unknown', 'unknown', true, now())"
                        " on conflict (organization_id, technician_id) where ended_at is null"
                        " do nothing",
                        (str(inv[0]), user_id),
                    )
                    await conn.execute(
                        "insert into user_organization_memberships"
                        " (user_id, organization_id, role, status)"
                        " values (%s, %s, 'technician', 'pending')"
                        " on conflict (user_id, organization_id) do nothing",
                        (user_id, str(inv[0])),
                    )
                    await conn.execute(
                        "update technician_invites set status = 'accepted',"
                        " accepted_at = now(), accepted_technician_id = %s where token = %s",
                        (user_id, token),
                    )
            return await self._session_for_user(conn, str(user_id))

    async def register_organization(self, data: dict) -> dict:
        email = (data.get("admin_email") or "").strip() or None
        pw_hash = hash_password(data["password"])
        org_name = data["organization_name"]
        async with await self._connect() as conn:
            if email:
                cur = await conn.execute("select 1 from users where lower(email) = lower(%s)", (email,))
                if await cur.fetchone():
                    raise ValueError("email_taken")
            base = _slugify(org_name)
            slug, n = base, 1
            while True:
                cur = await conn.execute("select 1 from organizations where slug = %s", (slug,))
                if not await cur.fetchone():
                    break
                n += 1
                slug = f"{base}-{n}"
            cur = await conn.execute(
                "insert into organizations (display_name, legal_name, slug, status, subscription_status,"
                " email, phone, service_area_center_lat, service_area_center_lng, service_area_radius_km,"
                " dispatch_mode, organization_type)"
                " values (%s, %s, %s, 'pending_review', 'none', %s, %s, %s, %s, %s,"
                " 'organization_managed', 'company') returning id",
                (
                    org_name, data.get("legal_name") or org_name, slug, email,
                    data.get("phone"),
                    data.get("service_area_center_lat"), data.get("service_area_center_lng"),
                    data.get("service_area_radius_km"),
                ),
            )
            org_id = (await cur.fetchone())[0]
            cur = await conn.execute(
                "insert into users (email, phone, password_hash, display_name, status, locale)"
                " values (%s, %s, %s, %s, 'active', %s) returning id",
                (email, data.get("phone"), pw_hash, data["admin_display_name"], data.get("locale")),
            )
            user_id = (await cur.fetchone())[0]
            await conn.execute(
                "insert into user_roles (user_id, role) values (%s, 'provider_admin') on conflict do nothing",
                (user_id,),
            )
            await conn.execute(
                "insert into user_organization_memberships (user_id, organization_id, role, status)"
                " values (%s, %s, 'provider_admin', 'active')"
                " on conflict (user_id, organization_id) do nothing",
                (user_id, org_id),
            )
            return await self._session_for_user(conn, str(user_id))

    async def list_organizations(self, status: str | None = None) -> list[dict]:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select o.id, o.display_name, o.legal_name, o.slug, o.organization_type,"
                " o.status, o.subscription_status, o.phone, o.email, o.created_at,"
                " (select count(*) from user_organization_memberships m where m.organization_id = o.id),"
                " (select count(*) from organization_technicians ot"
                "  where ot.organization_id = o.id and ot.ended_at is null)"
                " from organizations o"
                " where %s::text is null or o.status = %s"
                " order by o.created_at desc",
                (status, status),
            )
            rows = await cur.fetchall()
        return [
            {
                "id": str(r[0]), "display_name": r[1], "legal_name": r[2], "slug": r[3],
                "organization_type": r[4], "status": r[5], "subscription_status": r[6],
                "phone": r[7], "email": r[8], "created_at": r[9].isoformat() if r[9] else None,
                "member_count": r[10], "technician_count": r[11],
            }
            for r in rows
        ]

    async def get_organization_admin_detail(self, organization_id: UUID) -> dict | None:
        oid = str(organization_id)
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select id, display_name, legal_name, slug, organization_type, status,"
                " subscription_status, phone, email, created_at, fulfillment_policy"
                " from organizations where id = %s",
                (oid,),
            )
            row = await cur.fetchone()
            if row is None:
                return None
            org = {
                "id": str(row[0]), "display_name": row[1], "legal_name": row[2], "slug": row[3],
                "organization_type": row[4], "status": row[5], "subscription_status": row[6],
                "phone": row[7], "email": row[8], "created_at": row[9].isoformat() if row[9] else None,
                # surfaced as semantic vocabulary; an org is its own owner
                "fulfillment_policy": normalize_policy(row[10], str(row[0])),
            }
            cur = await conn.execute(
                "select u.id, u.display_name, u.email, u.phone, m.role, m.status, m.created_at"
                " from user_organization_memberships m join users u on u.id = m.user_id"
                " where m.organization_id = %s order by m.created_at",
                (oid,),
            )
            members = [
                {
                    "id": str(r[0]), "display_name": r[1], "email": r[2], "phone": r[3],
                    "role": r[4], "status": r[5], "created_at": r[6].isoformat() if r[6] else None,
                }
                for r in await cur.fetchall()
            ]
            cur = await conn.execute(
                "select t.id, t.display_name, t.status as technician_status, t.vetting_status,"
                " ot.status as affiliation_status, ot.affiliation_type, ot.starts_at"
                " from organization_technicians ot join technicians t on t.id = ot.technician_id"
                " where ot.organization_id = %s and ot.ended_at is null"
                " order by ot.starts_at desc",
                (oid,),
            )
            technicians = [
                {
                    "id": str(r[0]), "display_name": r[1], "technician_status": r[2],
                    "vetting_status": r[3], "affiliation_status": r[4], "affiliation_type": r[5],
                    "starts_at": r[6].isoformat() if r[6] else None,
                }
                for r in await cur.fetchall()
            ]
            cur = await conn.execute(
                "select id, document_type, document_number, status, expires_at, submitted_at"
                " from provider_documents where owner_type = 'organization' and owner_id = %s"
                " order by submitted_at desc",
                (oid,),
            )
            documents = [
                {
                    "id": str(r[0]), "document_type": r[1], "document_number": r[2],
                    "status": r[3], "expires_at": r[4].isoformat() if r[4] else None,
                    "submitted_at": r[5].isoformat() if r[5] else None,
                }
                for r in await cur.fetchall()
            ]
        org["members"] = members
        org["technicians"] = technicians
        org["documents"] = documents
        org["capabilities"] = await self.list_organization_capabilities(oid)
        return org

    async def list_technicians_admin(self, status: str | None = None) -> list[dict]:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select t.id, t.display_name, t.email, t.phone, t.status, t.vetting_status,"
                " t.skills, t.provider_type, t.primary_organization_id, t.created_at,"
                " o.display_name"
                " from technicians t left join organizations o on o.id = t.primary_organization_id"
                " where %s::text is null or t.status = %s"
                " order by t.created_at desc",
                (status, status),
            )
            rows = await cur.fetchall()
        return [
            {
                "id": str(r[0]), "display_name": r[1], "email": r[2], "phone": r[3],
                "status": r[4], "vetting_status": r[5], "skills": r[6] or [],
                "provider_type": r[7],
                "primary_organization_id": str(r[8]) if r[8] else None,
                "created_at": r[9].isoformat() if r[9] else None,
                "primary_organization_name": r[10],
            }
            for r in rows
        ]

    async def get_technician_admin_detail(self, technician_id: UUID) -> dict | None:
        tid = str(technician_id)
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select id, display_name, email, phone, status, vetting_status, skills,"
                " provider_type, profile_photo_url, profile_photo_status, created_at"
                " from technicians where id = %s",
                (tid,),
            )
            row = await cur.fetchone()
            if row is None:
                return None
            cur = await conn.execute(
                "select ot.id, o.display_name, ot.status, ot.affiliation_type"
                " from organization_technicians ot join organizations o on o.id = ot.organization_id"
                " where ot.technician_id = %s and ot.ended_at is null"
                " order by ot.starts_at desc",
                (tid,),
            )
            affiliations = [
                {"id": str(r[0]), "organization_name": r[1], "status": r[2], "affiliation_type": r[3]}
                for r in await cur.fetchall()
            ]
        technician = {
            "id": str(row[0]), "display_name": row[1], "email": row[2], "phone": row[3],
            "status": row[4], "vetting_status": row[5], "skills": row[6] or [],
            "provider_type": row[7], "profile_photo_url": row[8], "profile_photo_status": row[9],
            "created_at": row[10].isoformat() if row[10] else None,
        }
        technician["affiliations"] = affiliations
        technician["documents"] = await self.list_technician_documents(technician_id)
        return technician

    async def list_company_users_admin(self, organization_id: UUID | None = None) -> list[dict]:
        oid = str(organization_id) if organization_id else None
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select u.id, u.display_name, u.email, u.phone, u.status,"
                " m.role, m.organization_id, o.display_name, u.created_at"
                " from user_organization_memberships m"
                " join users u on u.id = m.user_id"
                " join organizations o on o.id = m.organization_id"
                " where %s::uuid is null or m.organization_id = %s"
                " order by u.created_at desc",
                (oid, oid),
            )
            rows = await cur.fetchall()
        return [
            {
                "id": str(r[0]), "display_name": r[1], "email": r[2], "phone": r[3], "status": r[4],
                "role": r[5], "organization_id": str(r[6]), "organization_name": r[7],
                "created_at": r[8].isoformat() if r[8] else None,
            }
            for r in rows
        ]

    async def list_platform_admins(self) -> list[dict]:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select u.id, u.display_name, u.email, u.phone, u.status, u.created_at"
                " from user_roles r join users u on u.id = r.user_id"
                " where r.role = 'platform_admin'"
                " order by u.created_at desc"
            )
            rows = await cur.fetchall()
        return [
            {
                "id": str(r[0]), "display_name": r[1], "email": r[2], "phone": r[3],
                "status": r[4], "created_at": r[5].isoformat() if r[5] else None,
            }
            for r in rows
        ]

    async def get_user_admin_detail(self, user_id: UUID) -> dict | None:
        uid = str(user_id)
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select id, display_name, email, phone, status, created_at from users where id = %s",
                (uid,),
            )
            row = await cur.fetchone()
            if row is None:
                return None
            cur = await conn.execute(
                "select role from user_roles where user_id = %s order by role", (uid,)
            )
            roles = [r[0] for r in await cur.fetchall()]
            cur = await conn.execute(
                "select m.organization_id, o.display_name, m.role, m.status"
                " from user_organization_memberships m join organizations o on o.id = m.organization_id"
                " where m.user_id = %s order by m.created_at",
                (uid,),
            )
            memberships = [
                {"organization_id": str(r[0]), "organization_name": r[1], "role": r[2], "status": r[3]}
                for r in await cur.fetchall()
            ]
        return {
            "id": str(row[0]), "display_name": row[1], "email": row[2], "phone": row[3],
            "status": row[4], "created_at": row[5].isoformat() if row[5] else None,
            "roles": roles, "memberships": memberships,
        }

    async def set_user_account_status(self, user_id: UUID, status: str) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "update users set status = %s, updated_at = now() where id = %s"
                " returning id, display_name, email, phone, status",
                (status, str(user_id)),
            )
            row = await cur.fetchone()
        if row is None:
            return None
        return {"id": str(row[0]), "display_name": row[1], "email": row[2], "phone": row[3], "status": row[4]}

    async def update_organization_member_role(
        self, user_id: UUID, organization_id: UUID, role: str
    ) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "update user_organization_memberships set role = %s"
                " where user_id = %s and organization_id = %s"
                " returning user_id, organization_id, role",
                (role, str(user_id), str(organization_id)),
            )
            row = await cur.fetchone()
        if row is None:
            return None
        return {"user_id": str(row[0]), "organization_id": str(row[1]), "role": row[2]}

    async def delete_or_archive_user(self, user_id: UUID, *, reason: str) -> dict | None:
        """Delete if nothing depends on this account; otherwise archive (status
        set to 'archived', same login-blocking effect as suspend) so audit
        history and admin-less-company integrity are preserved."""
        uid = str(user_id)
        async with await self._connect() as conn:
            cur = await conn.execute("select id, display_name from users where id = %s", (uid,))
            user = await cur.fetchone()
            if not user:
                return None
            cur = await conn.execute("select count(*) from governance_events where actor_id = %s", (uid,))
            governance_refs = int((await cur.fetchone())[0])
            cur = await conn.execute(
                "select count(*) from user_organization_memberships m"
                " where m.user_id = %s and m.role = 'provider_admin' and m.status = 'active'"
                " and not exists ("
                "   select 1 from user_organization_memberships m2"
                "   where m2.organization_id = m.organization_id and m2.user_id <> m.user_id"
                "   and m2.role = 'provider_admin' and m2.status = 'active'"
                " )",
                (uid,),
            )
            sole_admin_orgs = int((await cur.fetchone())[0])
            references = {"governance_events": governance_refs, "sole_admin_of_companies": sole_admin_orgs}
            total = sum(references.values())
            if total == 0:
                await conn.execute("delete from users where id = %s", (uid,))
                return {"id": uid, "display_name": user[1], "action": "deleted", "references": references, "reason": reason}
            cur = await conn.execute(
                "update users set status = 'archived', updated_at = now() where id = %s"
                " returning id, display_name, status",
                (uid,),
            )
            row = await cur.fetchone()
        return {
            "id": str(row[0]), "display_name": row[1], "status": row[2],
            "action": "archived", "references": references, "reason": reason,
        }

    async def create_platform_admin(self, data: dict) -> dict:
        email = (data.get("email") or "").strip() or None
        phone = (data.get("phone") or "").strip() or None
        pw_hash = hash_password(data["password"])
        async with await self._connect() as conn:
            if email:
                cur = await conn.execute("select 1 from users where lower(email) = lower(%s)", (email,))
                if await cur.fetchone():
                    raise ValueError("email_taken")
            if phone:
                cur = await conn.execute("select 1 from users where phone = %s", (phone,))
                if await cur.fetchone():
                    raise ValueError("phone_taken")
            cur = await conn.execute(
                "insert into users (email, phone, password_hash, display_name, status)"
                " values (%s, %s, %s, %s, 'active') returning id",
                (email, phone, pw_hash, data["display_name"]),
            )
            user_id = (await cur.fetchone())[0]
            await conn.execute(
                "insert into user_roles (user_id, role) values (%s, 'platform_admin') on conflict do nothing",
                (user_id,),
            )
        return {"id": str(user_id), "display_name": data["display_name"], "email": email, "phone": phone, "role": "platform_admin"}

    async def count_active_platform_admins(self) -> int:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select count(*) from user_roles r join users u on u.id = r.user_id"
                " where r.role = 'platform_admin' and u.status = 'active'"
            )
            row = await cur.fetchone()
        return int(row[0]) if row else 0

    async def list_organization_members(self, organization_id: UUID) -> list[dict]:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select u.id, u.display_name, u.email, u.phone, m.role, m.status, m.created_at"
                " from user_organization_memberships m join users u on u.id = m.user_id"
                " where m.organization_id = %s order by m.created_at",
                (str(organization_id),),
            )
            rows = await cur.fetchall()
        return [
            {
                "id": str(r[0]), "display_name": r[1], "email": r[2], "phone": r[3],
                "role": r[4], "status": r[5], "created_at": r[6].isoformat() if r[6] else None,
            }
            for r in rows
        ]

    async def count_organization_members(self, organization_id: UUID) -> int:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select count(*) from user_organization_memberships where organization_id = %s",
                (str(organization_id),),
            )
            row = await cur.fetchone()
        return int(row[0]) if row else 0

    async def create_organization_member(
        self, organization_id: UUID, data: dict, *, role: str
    ) -> dict:
        email = (data.get("email") or "").strip() or None
        phone = (data.get("phone") or "").strip() or None
        pw_hash = hash_password(data["password"])
        async with await self._connect() as conn:
            if email:
                cur = await conn.execute("select 1 from users where lower(email) = lower(%s)", (email,))
                if await cur.fetchone():
                    raise ValueError("email_taken")
            if phone:
                cur = await conn.execute("select 1 from users where phone = %s", (phone,))
                if await cur.fetchone():
                    raise ValueError("phone_taken")
            cur = await conn.execute(
                "insert into users (email, phone, password_hash, display_name, status)"
                " values (%s, %s, %s, %s, 'active') returning id",
                (email, phone, pw_hash, data["display_name"]),
            )
            user_id = (await cur.fetchone())[0]
            await conn.execute(
                "insert into user_roles (user_id, role) values (%s, %s) on conflict do nothing",
                (user_id, role),
            )
            await conn.execute(
                "insert into user_organization_memberships (user_id, organization_id, role, status)"
                " values (%s, %s, %s, 'active')"
                " on conflict (user_id, organization_id) do nothing",
                (user_id, str(organization_id), role),
            )
        return {
            "id": str(user_id), "display_name": data["display_name"],
            "email": email, "phone": phone, "role": role,
        }

    async def count_organization_technician_slots(self, organization_id: UUID) -> int:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select"
                " (select count(*) from organization_technicians"
                "  where organization_id = %s and ended_at is null)"
                " + (select count(*) from technician_invites"
                "    where organization_id = %s and status = 'pending' and expires_at > now())",
                (str(organization_id), str(organization_id)),
            )
            row = await cur.fetchone()
        return int(row[0]) if row else 0

    async def approve_technician(self, technician_id: UUID) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "update technicians set vetting_status = 'verified', status = 'active'"
                " where id = %s returning id, display_name, status, vetting_status",
                (str(technician_id),),
            )
            row = await cur.fetchone()
        if not row:
            return None
        return {"id": str(row[0]), "display_name": row[1], "status": row[2], "vetting_status": row[3]}

    async def set_technician_status(self, technician_id: UUID, status: str) -> dict | None:
        if status == "suspended":
            sql = (
                "update technicians set status = %s, is_available = false"
                " where id = %s returning id, display_name, status, vetting_status"
            )
        else:
            sql = (
                "update technicians set status = %s"
                " where id = %s returning id, display_name, status, vetting_status"
            )
        async with await self._connect() as conn:
            cur = await conn.execute(sql, (status, str(technician_id)))
            row = await cur.fetchone()
        if not row:
            return None
        return {"id": str(row[0]), "display_name": row[1], "status": row[2], "vetting_status": row[3]}

    async def approve_organization(self, organization_id: UUID) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "update organizations set status = 'active', updated_at = now()"
                " where id = %s returning id, display_name, status",
                (str(organization_id),),
            )
            row = await cur.fetchone()
        if not row:
            return None
        return {"id": str(row[0]), "display_name": row[1], "status": row[2]}

    async def reject_technician(self, technician_id: UUID) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "update technicians set vetting_status = 'rejected', status = 'rejected', is_available = false"
                " where id = %s returning id, display_name, status, vetting_status",
                (str(technician_id),),
            )
            row = await cur.fetchone()
        if not row:
            return None
        return {"id": str(row[0]), "display_name": row[1], "status": row[2], "vetting_status": row[3]}

    async def reject_organization(self, organization_id: UUID) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "update organizations set status = 'rejected', updated_at = now()"
                " where id = %s returning id, display_name, status",
                (str(organization_id),),
            )
            row = await cur.fetchone()
        if not row:
            return None
        return {"id": str(row[0]), "display_name": row[1], "status": row[2]}

    async def delete_or_archive_organization(self, organization_id: UUID, *, reason: str) -> dict | None:
        oid = str(organization_id)
        async with await self._connect() as conn:
            cur = await conn.execute("select id, display_name from organizations where id = %s", (oid,))
            org = await cur.fetchone()
            if not org:
                return None
            reference_queries = [
                ("members", "select count(*) from user_organization_memberships where organization_id = %s"),
                ("technicians", "select count(*) from organization_technicians where organization_id = %s"),
                ("documents", "select count(*) from provider_documents where owner_type = 'organization' and owner_id = %s"),
                ("settings", "select count(*) from organization_settings where organization_id = %s"),
                ("teams", "select count(*) from organization_teams where organization_id = %s"),
                ("invites", "select count(*) from technician_invites where organization_id = %s"),
                ("jobs", "select count(*) from jobs where origin_org_id = %s or customer_owner_org_id = %s or fulfillment_org_id = %s"),
            ]
            references: dict[str, int] = {}
            for key, sql in reference_queries:
                args = (oid, oid, oid) if key == "jobs" else (oid,)
                cur = await conn.execute(sql, args)
                row = await cur.fetchone()
                references[key] = int(row[0]) if row else 0
            total = sum(references.values())
            if total == 0:
                await conn.execute("delete from organizations where id = %s", (oid,))
                return {"id": oid, "display_name": org[1], "action": "deleted", "references": references, "reason": reason}
            cur = await conn.execute(
                "update organizations set status = 'closed', updated_at = now()"
                " where id = %s returning id, display_name, status",
                (oid,),
            )
            row = await cur.fetchone()
        return {
            "id": str(row[0]), "display_name": row[1], "status": row[2],
            "action": "archived", "references": references, "reason": reason,
        }

    async def set_organization_status(self, organization_id: UUID, status: str) -> dict | None:
        """Ops transition of a company between active/suspended (and closed). Canonical
        org lifecycle: pending_review | active | suspended | rejected | closed."""
        async with await self._connect() as conn:
            cur = await conn.execute(
                "update organizations set status = %s, updated_at = now()"
                " where id = %s returning id, display_name, status",
                (status, str(organization_id)),
            )
            row = await cur.fetchone()
        if not row:
            return None
        return {"id": str(row[0]), "display_name": row[1], "status": row[2]}

    async def delete_or_archive_technician(self, technician_id: UUID, *, reason: str) -> dict | None:
        tid = str(technician_id)
        async with await self._connect() as conn:
            cur = await conn.execute("select id, display_name from technicians where id = %s", (tid,))
            technician = await cur.fetchone()
            if not technician:
                return None
            reference_queries = [
                ("affiliations", "select count(*) from organization_technicians where technician_id = %s"),
                ("documents", "select count(*) from technician_documents where technician_id = %s"),
                ("offers", "select count(*) from dispatch_offers where technician_id = %s"),
                ("jobs", "select count(*) from jobs where fulfillment_technician_id = %s"),
                ("media", "select count(*) from media where owner_type = 'technician' and owner_id = %s"),
            ]
            references: dict[str, int] = {}
            for key, sql in reference_queries:
                cur = await conn.execute(sql, (tid,))
                row = await cur.fetchone()
                references[key] = int(row[0]) if row else 0
            total = sum(references.values())
            if total == 0:
                await conn.execute("delete from technicians where id = %s", (tid,))
                return {"id": tid, "display_name": technician[1], "action": "deleted", "references": references, "reason": reason}
            cur = await conn.execute(
                "update technicians set status = 'archived', is_available = false"
                " where id = %s returning id, display_name, status, vetting_status",
                (tid,),
            )
            row = await cur.fetchone()
        return {
            "id": str(row[0]), "display_name": row[1], "status": row[2],
            "vetting_status": row[3], "action": "archived",
            "references": references, "reason": reason,
        }

    async def record_governance_event(
        self,
        *,
        entity_type: str,
        entity_id: UUID,
        action: str,
        reason: str | None = None,
        actor_id: UUID | str | None = None,
        metadata: dict | None = None,
    ) -> dict:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "insert into governance_events"
                " (entity_type, entity_id, action, reason, actor_id, metadata)"
                " values (%s, %s, %s, %s, %s, %s::jsonb)"
                " returning id, entity_type, entity_id, action, reason, actor_id, metadata, created_at",
                (
                    entity_type,
                    str(entity_id),
                    action,
                    reason,
                    str(actor_id) if actor_id else None,
                    json.dumps(metadata or {}),
                ),
            )
            row = await cur.fetchone()
        return {
            "id": str(row[0]),
            "entity_type": row[1],
            "entity_id": str(row[2]),
            "action": row[3],
            "reason": row[4],
            "actor_id": str(row[5]) if row[5] else None,
            "metadata": row[6] or {},
            "created_at": row[7].isoformat() if hasattr(row[7], "isoformat") else row[7],
        }

    async def list_governance_events(
        self, entity_type: str, entity_id: UUID, *, limit: int = 50
    ) -> list[dict]:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select id, entity_type, entity_id, action, reason, actor_id, metadata, created_at"
                " from governance_events"
                " where entity_type = %s and entity_id = %s"
                " order by created_at desc limit %s",
                (entity_type, str(entity_id), limit),
            )
            rows = await cur.fetchall()
        return [
            {
                "id": str(row[0]),
                "entity_type": row[1],
                "entity_id": str(row[2]),
                "action": row[3],
                "reason": row[4],
                "actor_id": str(row[5]) if row[5] else None,
                "metadata": row[6] or {},
                "created_at": row[7].isoformat() if hasattr(row[7], "isoformat") else row[7],
            }
            for row in rows
        ]

    async def update_user_locale(self, user_id: str, locale: str) -> None:
        async with await self._connect() as conn:
            await conn.execute(
                "update users set locale = %s, updated_at = now() where id = %s",
                (locale, str(user_id)),
            )

    async def update_user_profile(self, user_id: str, data: dict) -> dict | None | str:
        email = data.get("email")
        phone = data.get("phone")
        display_name = data.get("display_name")
        async with await self._connect() as conn:
            if email is not None:
                cur = await conn.execute(
                    "select 1 from users where lower(email) = lower(%s) and id <> %s",
                    (email, str(user_id)),
                )
                if await cur.fetchone():
                    return "email_taken"
            if phone is not None:
                cur = await conn.execute(
                    "select 1 from users where phone = %s and id <> %s",
                    (phone, str(user_id)),
                )
                if await cur.fetchone():
                    return "phone_taken"
            cur = await conn.execute(
                "update users set"
                " display_name = coalesce(%s, display_name),"
                " email = coalesce(%s, email),"
                " phone = coalesce(%s, phone),"
                " updated_at = now()"
                " where id = %s"
                " returning id, display_name, email, phone",
                (display_name, email, phone, str(user_id)),
            )
            row = await cur.fetchone()
        if row is None:
            return None
        return {"id": str(row[0]), "display_name": row[1], "email": row[2], "phone": row[3]}

    async def change_user_password(self, user_id: str, current_password: str, new_password: str) -> bool:
        async with await self._connect() as conn:
            cur = await conn.execute("select password_hash from users where id = %s", (str(user_id),))
            row = await cur.fetchone()
            if row is None or not verify_password(current_password, row[0]):
                return False
            await conn.execute(
                "update users set password_hash = %s, updated_at = now() where id = %s",
                (hash_password(new_password), str(user_id)),
            )
        return True

    async def update_technician_profile(self, technician_id: UUID, data: dict) -> dict | None:
        try:
            async with await self._connect() as conn:
                cur = await conn.execute(
                    "update technicians set"
                    " display_name = coalesce(%s, display_name),"
                    " phone = coalesce(%s, phone),"
                    " skills = coalesce(%s, skills),"
                    " service_area_radius_km = coalesce(%s, service_area_radius_km)"
                    " where id = %s"
                    " returning id, display_name, phone, skills, service_area_radius_km",
                    (
                        data.get("display_name"),
                        data.get("phone"),
                        data.get("skills"),
                        data.get("service_area_radius_km"),
                        str(technician_id),
                    ),
                )
                row = await cur.fetchone()
                if row is None:
                    return None
                await conn.execute(
                    "update users set"
                    " display_name = coalesce(%s, display_name),"
                    " phone = coalesce(%s, phone), updated_at = now()"
                    " where id = %s",
                    (data.get("display_name"), data.get("phone"), str(technician_id)),
                )
        except Exception as exc:
            if "unique" in str(exc).lower() or "duplicate" in str(exc).lower():
                raise ValueError("Phone number is already in use")
            raise
        return {
            "id": str(row[0]),
            "display_name": row[1],
            "phone": row[2],
            "skills": list(row[3] or []),
            "service_area_radius_km": row[4],
        }

    async def list_pending_registrations(self) -> list[dict]:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select 'technician' as kind, t.id, t.display_name, t.email, t.phone,"
                " t.status, t.vetting_status, t.created_at"
                " from technicians t"
                " where t.status = 'pending_vetting' or t.vetting_status = 'unverified'"
                " union all"
                " select 'organization' as kind, o.id, o.display_name, o.email, o.phone,"
                " o.status, null, o.created_at"
                " from organizations o where o.status in ('pending', 'pending_vetting', 'pending_review')"
                " order by created_at"
            )
            rows = await cur.fetchall()
        return [
            {
                "kind": row[0],
                "id": str(row[1]),
                "display_name": row[2],
                "email": row[3],
                "phone": row[4],
                "status": row[5],
                "vetting_status": row[6],
                "created_at": row[7].isoformat() if row[7] else None,
            }
            for row in rows
        ]

    async def list_pending_documents(self) -> list[dict]:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select d.id, d.owner_type, d.owner_id, d.document_type, d.document_number,"
                " d.issuing_authority, d.jurisdiction, d.expires_at, d.status, d.submitted_at,"
                " case when d.owner_type = 'organization' then o.display_name else t.display_name end"
                " from provider_documents d"
                " left join organizations o on d.owner_type = 'organization' and o.id = d.owner_id"
                " left join technicians t on d.owner_type = 'technician' and t.id = d.owner_id"
                " where d.status = 'pending_review' order by d.submitted_at"
            )
            rows = await cur.fetchall()
        return [
            {
                "id": str(row[0]), "owner_type": row[1], "owner_id": str(row[2]),
                "document_type": row[3], "document_number": row[4],
                "issuing_authority": row[5], "jurisdiction": row[6],
                "expires_at": row[7].isoformat() if row[7] else None,
                "status": row[8], "submitted_at": row[9].isoformat() if row[9] else None,
                "owner_name": row[10],
            }
            for row in rows
        ]

    async def list_pending_technician_photos(self) -> list[dict]:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select id, display_name, email, phone, profile_photo_url,"
                " profile_photo_status, status, vetting_status, created_at"
                " from technicians"
                " where profile_photo_url is not null and profile_photo_status = 'pending'"
                " order by created_at"
            )
            rows = await cur.fetchall()
        return [
            {
                "technician_id": str(row[0]),
                "display_name": row[1],
                "email": row[2],
                "phone": row[3],
                "photo_url": row[4],
                "photo_status": row[5],
                "status": row[6],
                "vetting_status": row[7],
                "updated_at": row[8].isoformat() if row[8] else None,
            }
            for row in rows
        ]

    async def get_provider_document(self, document_id: UUID) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select id, storage_bucket, storage_path, document_type"
                " from provider_documents where id = %s",
                (str(document_id),),
            )
            row = await cur.fetchone()
        if not row:
            return None
        return {
            "id": str(row[0]), "storage_bucket": row[1], "storage_path": row[2],
            "document_type": row[3],
        }

    async def get_provider_workspace(self, organization_id: UUID) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select id, display_name, legal_name, description, slug, status, phone, email,"
                " service_area_center_lat, service_area_center_lng, service_area_radius_km,"
                " dispatch_mode, fulfillment_policy,"
                " contact_name, contact_title, contact_email, contact_phone,"
                " address_line1, address_line2, city, region, postal_code, country_code,"
                " website, customer_care_phone, google_profile_url, google_review_url,"
                " logo_url, service_postal_codes"
                " from organizations where id = %s",
                (str(organization_id),),
            )
            org = await cur.fetchone()
            if not org:
                return None
            cur = await conn.execute(
                "select t.id, t.parent_team_id, t.name, t.description, t.team_type, t.status,"
                " count(ott.technician_id)::integer"
                " from organization_teams t"
                " left join organization_team_technicians ott on ott.team_id = t.id"
                " where t.organization_id = %s"
                " group by t.id order by t.name",
                (str(organization_id),),
            )
            team_rows = await cur.fetchall()
            cur = await conn.execute(
                "select t.id, t.display_name, t.email, t.phone, t.status, t.vetting_status,"
                " t.skills, t.provider_type, t.is_available,"
                " ot.status, ot.affiliation_type, ot.exclusivity, ot.dispatch_allowed,"
                " ot.ended_at,"
                " coalesce(array_remove(array_agg(distinct ott.team_id), null), '{}')"
                " from technicians t"
                " join organization_technicians ot on ot.technician_id = t.id"
                " left join organization_team_technicians ott on ott.technician_id = t.id"
                " where ot.organization_id = %s"
                " and ot.ended_at is null"
                " group by t.id, ot.status, ot.affiliation_type, ot.exclusivity,"
                " ot.dispatch_allowed, ot.ended_at order by t.display_name",
                (str(organization_id),),
            )
            technician_rows = await cur.fetchall()
            cur = await conn.execute(
                "select id, owner_type, owner_id, document_type, document_number,"
                " issuing_authority, jurisdiction, issued_at, expires_at, status,"
                " storage_bucket, storage_path, notes, submitted_at, verified_at"
                " from provider_documents"
                " where (owner_type = 'organization' and owner_id = %s)"
                " or (owner_type = 'technician' and owner_id in ("
                "   select technician_id from organization_technicians where organization_id = %s"
                " )) order by submitted_at desc",
                (str(organization_id), str(organization_id)),
            )
            document_rows = await cur.fetchall()
        return {
            "organization": {
                "id": str(org[0]),
                "display_name": org[1],
                "legal_name": org[2],
                "description": org[3],
                "slug": org[4],
                "status": org[5],
                "phone": org[6],
                "email": org[7],
                "service_area_center_lat": org[8],
                "service_area_center_lng": org[9],
                "service_area_radius_km": org[10],
                "dispatch_mode": org[11],
                # stored as the canonical DB vocabulary; surfaced in semantic form
                # (an org is its own owner, so this is its effective default policy)
                "fulfillment_policy": normalize_policy(org[12], str(org[0])),
                "contact_name": org[13],
                "contact_title": org[14],
                "contact_email": org[15],
                "contact_phone": org[16],
                "address_line1": org[17],
                "address_line2": org[18],
                "city": org[19],
                "region": org[20],
                "postal_code": org[21],
                "country_code": org[22],
                "website": org[23],
                "customer_care_phone": org[24],
                "google_profile_url": org[25],
                "google_review_url": org[26],
                "logo_url": org[27],
                "service_postal_codes": list(org[28] or []),
            },
            "teams": [
                {
                    "id": str(row[0]),
                    "parent_team_id": str(row[1]) if row[1] else None,
                    "name": row[2],
                    "description": row[3],
                    "team_type": row[4],
                    "status": row[5],
                    "member_count": row[6],
                }
                for row in team_rows
            ],
            "technicians": [
                {
                    "id": str(row[0]),
                    "display_name": row[1],
                    "email": row[2],
                    "phone": row[3],
                    "status": row[4],
                    "global_status": row[4],
                    "vetting_status": row[5],
                    "skills": row[6] or [],
                    "provider_type": row[7],
                    "is_available": row[8],
                    "affiliation": {
                        "status": row[9],
                        "affiliation_type": row[10],
                        "exclusivity": row[11],
                        "dispatch_allowed": bool(row[12]),
                        "ended_at": row[13].isoformat() if row[13] else None,
                        "is_pending_invite": row[9] == "pending_invite",
                    },
                    "team_ids": [str(team_id) for team_id in (row[14] or [])],
                }
                for row in technician_rows
            ],
            "documents": [
                {
                    "id": str(row[0]),
                    "owner_type": row[1],
                    "owner_id": str(row[2]),
                    "document_type": row[3],
                    "document_number": row[4],
                    "issuing_authority": row[5],
                    "jurisdiction": row[6],
                    "issued_at": row[7].isoformat() if row[7] else None,
                    "expires_at": row[8].isoformat() if row[8] else None,
                    "status": row[9],
                    "storage_bucket": row[10],
                    "storage_path": row[11],
                    "notes": row[12],
                    "submitted_at": row[13].isoformat() if row[13] else None,
                    "verified_at": row[14].isoformat() if row[14] else None,
                }
                for row in document_rows
            ],
        }

    async def list_affiliated_technicians_directory(self, organization_id: UUID) -> list[dict]:
        """Operational directory of the company's affiliated technicians (open
        affiliation periods only — tenant-scoped to this org). Each row carries
        the global technician status, derived availability, completed-job count,
        rating, affiliation date, skills, and a compliance summary so the portal
        never needs mock data. Document compliance counts ONLY the technician's
        own credentials (provider companies do not own technician documents)."""
        active_job = ("assigned", "en_route", "arrived", "in_progress", "completed_pending_customer")
        completed = ("completed_confirmed", "completed_auto_closed")
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select t.id, t.display_name, t.email, t.phone, t.status, t.vetting_status,"
                " t.skills, t.is_available, t.rating, t.location_updated_at,"
                " t.profile_photo_url, t.profile_photo_status,"
                " ot.status, ot.affiliation_type, ot.exclusivity, ot.dispatch_allowed, ot.starts_at,"
                " (select count(*) from jobs j where j.fulfillment_technician_id = t.id"
                "   and (j.fulfillment_org_id = %s or j.customer_owner_org_id = %s)"
                "   and j.status = any(%s)) as completed_jobs,"
                " exists(select 1 from jobs j2 where j2.fulfillment_technician_id = t.id"
                "   and j2.status = any(%s)) as on_job"
                " from technicians t"
                " join organization_technicians ot on ot.technician_id = t.id"
                " where ot.organization_id = %s and ot.ended_at is null"
                " order by t.display_name",
                (str(organization_id), str(organization_id), list(completed), list(active_job), str(organization_id)),
            )
            rows = await cur.fetchall()
            cur = await conn.execute(
                "select owner_id, document_type, status, expires_at"
                " from provider_documents"
                " where owner_type = 'technician' and owner_id in ("
                "   select technician_id from organization_technicians"
                "   where organization_id = %s and ended_at is null)",
                (str(organization_id),),
            )
            doc_rows = await cur.fetchall()
        today = datetime.now(timezone.utc).date()
        soon = today + timedelta(days=30)
        docs_by_tech: dict[str, dict] = {}
        for owner_id, dtype, dstatus, expires_at in doc_rows:
            agg = docs_by_tech.setdefault(str(owner_id), {
                "total": 0, "verified": 0, "pending": 0, "rejected": 0,
                "expired": [], "expiring": [],
            })
            agg["total"] += 1
            if dstatus == "verified":
                agg["verified"] += 1
            elif dstatus == "rejected":
                agg["rejected"] += 1
            elif dstatus != "expired":
                agg["pending"] += 1
            if dstatus == "expired" or (expires_at is not None and expires_at < today):
                agg["expired"].append(dtype)
            elif expires_at is not None and expires_at <= soon:
                agg["expiring"].append(dtype)
        out: list[dict] = []
        for r in rows:
            on_job = bool(r[18])
            if on_job:
                availability = "busy"
            elif r[4] == "active" and r[7]:
                availability = "free"
            else:
                availability = "offline"
            compliance = docs_by_tech.get(str(r[0]), {
                "total": 0, "verified": 0, "pending": 0, "rejected": 0,
                "expired": [], "expiring": [],
            })
            if compliance["total"] == 0:
                compliance_status = "no_documents"
            elif compliance["expired"] or compliance["rejected"]:
                compliance_status = "action_required"
            elif compliance["expiring"] or compliance["pending"]:
                compliance_status = "attention"
            else:
                compliance_status = "compliant"
            out.append({
                "id": str(r[0]),
                "display_name": r[1],
                "email": r[2],
                "phone": r[3],
                "profile_photo_url": r[10] if r[11] == "approved" else None,
                "profile_photo_status": r[11],
                "status": r[4],
                "vetting_status": r[5],
                "skills": list(r[6] or []),
                "is_available": r[7],
                "availability": availability,
                "rating": float(r[8]) if r[8] is not None else None,
                "location_updated_at": r[9].isoformat() if r[9] else None,
                "affiliation": {
                    "status": r[12],
                    "affiliation_type": r[13],
                    "exclusivity": r[14],
                    "dispatch_allowed": bool(r[15]),
                    "affiliated_at": r[16].isoformat() if r[16] else None,
                    "is_pending_invite": r[12] == "pending_invite",
                },
                "completed_jobs": int(r[17] or 0),
                "compliance": {**compliance, "summary": compliance_status},
            })
        return out

    async def create_technician_invite(
        self, organization_id: UUID, *, email: str | None, invited_by: str | None,
    ) -> dict:
        """Create (or refresh) a pending invite for a NEW technician — one with no
        ClueXP account yet. Returns a one-time token the company can share as a
        signup link; on signup the token attaches the technician to this org as a
        pending affiliation. Existing technicians are attached directly via
        ``create_affiliated_technician`` instead, so this is the no-account path."""
        token = secrets.token_urlsafe(24)
        expires = datetime.now(timezone.utc) + timedelta(days=14)
        async with await self._connect() as conn:
            cur = await conn.execute(
                "insert into technician_invites"
                " (organization_id, email, token, status, invited_by, expires_at)"
                " values (%s, %s, %s, 'pending', %s, %s)"
                " returning id, email, token, status, created_at, expires_at",
                (str(organization_id), email, token, invited_by, expires),
            )
            row = await cur.fetchone()
        return {
            "id": str(row[0]), "email": row[1], "token": row[2], "status": row[3],
            "created_at": row[4].isoformat() if row[4] else None,
            "expires_at": row[5].isoformat() if row[5] else None,
        }

    async def list_technician_invites(self, organization_id: UUID) -> list[dict]:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select id, email, token, status, created_at, expires_at, accepted_at"
                " from technician_invites where organization_id = %s"
                " order by created_at desc",
                (str(organization_id),),
            )
            rows = await cur.fetchall()
        return [
            {
                "id": str(r[0]), "email": r[1], "token": r[2], "status": r[3],
                "created_at": r[4].isoformat() if r[4] else None,
                "expires_at": r[5].isoformat() if r[5] else None,
                "accepted_at": r[6].isoformat() if r[6] else None,
            }
            for r in rows
        ]

    async def resolve_technician_invite(self, token: str) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select i.id, i.organization_id, i.email, i.status, i.expires_at, o.display_name"
                " from technician_invites i join organizations o on o.id = i.organization_id"
                " where i.token = %s",
                (token,),
            )
            row = await cur.fetchone()
        if not row:
            return None
        return {
            "id": str(row[0]), "organization_id": str(row[1]), "email": row[2],
            "status": row[3], "expires_at": row[4].isoformat() if row[4] else None,
            "organization_name": row[5],
        }

    async def find_technician_by_email(self, email: str) -> dict | None:
        """Look up an existing technician by login email (users.email). Used by the
        invite flow to attach an already-registered technician directly rather than
        minting a signup token."""
        target = (email or "").strip()
        if not target:
            return None
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select t.id, t.display_name from technicians t"
                " join users u on u.id = t.id where lower(u.email) = lower(%s)",
                (target,),
            )
            row = await cur.fetchone()
        if not row:
            return None
        return {"id": str(row[0]), "display_name": row[1]}

    async def ensure_intake_channel(self, organization_id: UUID) -> dict | None:
        """Guarantee the company has a branded intake slug, generating a unique one
        from its name if absent. Returns {slug}. Tenant-scoped to the caller's org."""
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select slug, display_name, legal_name from organizations where id = %s",
                (str(organization_id),),
            )
            row = await cur.fetchone()
            if not row:
                return None
            if row[0]:
                return {"slug": row[0]}
            base = _slugify(row[1] or row[2] or "company")
            slug, n = base, 1
            while True:
                cur = await conn.execute("select 1 from organizations where slug = %s", (slug,))
                if not await cur.fetchone():
                    break
                n += 1
                slug = f"{base}-{n}"
            await conn.execute(
                "update organizations set slug = %s, updated_at = now() where id = %s",
                (slug, str(organization_id)),
            )
        return {"slug": slug}

    async def update_organization_profile(self, organization_id: UUID, data: dict) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "update organizations set"
                " display_name = coalesce(%s, display_name),"
                " legal_name = coalesce(%s, legal_name),"
                " description = coalesce(%s, description),"
                " phone = coalesce(%s, phone),"
                " email = coalesce(%s, email),"
                " service_area_center_lat = coalesce(%s, service_area_center_lat),"
                " service_area_center_lng = coalesce(%s, service_area_center_lng),"
                " service_area_radius_km = coalesce(%s, service_area_radius_km),"
                " dispatch_mode = coalesce(%s, dispatch_mode),"
                " fulfillment_policy = coalesce(%s, fulfillment_policy),"
                " updated_at = now()"
                " where id = %s returning id, display_name, status",
                (
                    data.get("display_name"), data.get("legal_name"), data.get("description"),
                    data.get("phone"), data.get("email"), data.get("service_area_center_lat"),
                    data.get("service_area_center_lng"), data.get("service_area_radius_km"),
                    data.get("dispatch_mode"), data.get("fulfillment_policy"),
                    str(organization_id),
                ),
            )
            row = await cur.fetchone()
        return {"id": str(row[0]), "display_name": row[1], "status": row[2]} if row else None

    async def update_company_profile(self, organization_id: UUID, data: dict) -> dict | None:
        # Only whitelisted profile columns; `data` already contains solely the keys
        # the client sent (endpoint uses exclude_unset), so a present key with a null
        # value clears that column — explicit assignment, not coalesce.
        columns = [c for c in COMPANY_PROFILE_COLUMNS if c in data]
        if not columns:
            async with await self._connect() as conn:
                cur = await conn.execute(
                    "select id, display_name, status from organizations where id = %s",
                    (str(organization_id),),
                )
                row = await cur.fetchone()
            return {"id": str(row[0]), "display_name": row[1], "status": row[2]} if row else None
        assignments = ", ".join(f"{c} = %s" for c in columns)
        params = [data[c] for c in columns]
        params.append(str(organization_id))
        async with await self._connect() as conn:
            cur = await conn.execute(
                f"update organizations set {assignments}, updated_at = now()"
                " where id = %s returning id, display_name, status",
                tuple(params),
            )
            row = await cur.fetchone()
        return {"id": str(row[0]), "display_name": row[1], "status": row[2]} if row else None

    async def set_organization_logo(self, organization_id: UUID, logo_url: str) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "update organizations set logo_url = %s, updated_at = now()"
                " where id = %s returning id, logo_url",
                (logo_url, str(organization_id)),
            )
            row = await cur.fetchone()
        return {"id": str(row[0]), "logo_url": row[1]} if row else None

    async def create_team(self, organization_id: UUID, data: dict) -> dict:
        parent_id = data.get("parent_team_id")
        async with await self._connect() as conn:
            if parent_id:
                cur = await conn.execute(
                    "select 1 from organization_teams where id = %s and organization_id = %s",
                    (parent_id, str(organization_id)),
                )
                if not await cur.fetchone():
                    raise ValueError("parent_team_not_found")
            cur = await conn.execute(
                "insert into organization_teams"
                " (organization_id, parent_team_id, name, description, team_type, status)"
                " values (%s, %s, %s, %s, %s, 'active')"
                " returning id, parent_team_id, name, description, team_type, status",
                (
                    str(organization_id), parent_id, data["name"], data.get("description"),
                    data.get("team_type") or "team",
                ),
            )
            row = await cur.fetchone()
        return {
            "id": str(row[0]), "parent_team_id": str(row[1]) if row[1] else None,
            "name": row[2], "description": row[3], "team_type": row[4], "status": row[5],
            "member_count": 0,
        }

    async def update_team(
        self, organization_id: UUID, team_id: UUID, data: dict
    ) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "update organization_teams set"
                " name = coalesce(%s, name), description = coalesce(%s, description),"
                " status = coalesce(%s, status), updated_at = now()"
                " where id = %s and organization_id = %s"
                " returning id, parent_team_id, name, description, team_type, status",
                (
                    data.get("name"), data.get("description"), data.get("status"),
                    str(team_id), str(organization_id),
                ),
            )
            row = await cur.fetchone()
        if not row:
            return None
        return {
            "id": str(row[0]), "parent_team_id": str(row[1]) if row[1] else None,
            "name": row[2], "description": row[3], "team_type": row[4], "status": row[5],
        }

    async def delete_team(self, organization_id: UUID, team_id: UUID) -> str | None:
        """Safe delete: 404 (None) if not owned; refuse (`has_children`) while active
        sub-teams exist; otherwise drop memberships then the team."""
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select 1 from organization_teams where id = %s and organization_id = %s",
                (str(team_id), str(organization_id)),
            )
            if await cur.fetchone() is None:
                return None
            cur = await conn.execute(
                "select count(*) from organization_teams"
                " where parent_team_id = %s and status <> 'archived'",
                (str(team_id),),
            )
            if (await cur.fetchone())[0] > 0:
                raise ValueError("has_children")
            await conn.execute(
                "delete from organization_team_technicians where team_id = %s", (str(team_id),)
            )
            await conn.execute(
                "delete from organization_teams where id = %s and organization_id = %s",
                (str(team_id), str(organization_id)),
            )
        return "deleted"

    async def add_team_technician(
        self, organization_id: UUID, team_id: UUID, technician_id: UUID, *, role: str | None = None
    ) -> dict:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select 1 from organization_teams where id = %s and organization_id = %s",
                (str(team_id), str(organization_id)),
            )
            if await cur.fetchone() is None:
                return {"error_code": "team_not_found"}
            cur = await conn.execute(
                "select 1 from organization_technicians"
                " where organization_id = %s and technician_id = %s"
                "   and status = 'active' and ended_at is null",
                (str(organization_id), str(technician_id)),
            )
            if await cur.fetchone() is None:
                return {"error_code": "not_affiliated"}
            cur = await conn.execute(
                "select 1 from organization_team_technicians"
                " where team_id = %s and technician_id = %s",
                (str(team_id), str(technician_id)),
            )
            if await cur.fetchone() is not None:
                await conn.execute(
                    "update organization_team_technicians set role = %s"
                    " where team_id = %s and technician_id = %s",
                    (role, str(team_id), str(technician_id)),
                )
                return {"added": False, "team_id": str(team_id), "technician_id": str(technician_id)}
            await conn.execute(
                "insert into organization_team_technicians (team_id, technician_id, role)"
                " values (%s, %s, %s)",
                (str(team_id), str(technician_id), role),
            )
        return {"added": True, "team_id": str(team_id), "technician_id": str(technician_id)}

    async def remove_team_technician(
        self, organization_id: UUID, team_id: UUID, technician_id: UUID
    ) -> bool:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "delete from organization_team_technicians ott"
                " using organization_teams t"
                " where ott.team_id = t.id and t.organization_id = %s"
                "   and ott.team_id = %s and ott.technician_id = %s",
                (str(organization_id), str(team_id), str(technician_id)),
            )
            return cur.rowcount > 0

    async def get_provider_technician_detail(
        self, organization_id: UUID, technician_id: UUID
    ) -> dict | None:
        """Tenant-scoped read-only technician profile: base + open affiliation +
        team memberships + company/global review summaries + compliance documents.
        None when the technician has no open affiliation with this org."""
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select t.display_name, t.email, t.phone, t.profile_photo_url,"
                " t.profile_photo_status, t.status, t.vetting_status, t.skills, t.rating,"
                " t.location_updated_at, ot.status, ot.affiliation_type, ot.exclusivity,"
                " ot.dispatch_allowed, ot.starts_at"
                " from technicians t"
                " join organization_technicians ot on ot.technician_id = t.id"
                " where t.id = %s and ot.organization_id = %s and ot.ended_at is null",
                (str(technician_id), str(organization_id)),
            )
            row = await cur.fetchone()
            if row is None:
                return None
            cur = await conn.execute(
                "select t.id, t.name, ott.role from organization_team_technicians ott"
                " join organization_teams t on t.id = ott.team_id"
                " where ott.technician_id = %s and t.organization_id = %s order by t.name",
                (str(technician_id), str(organization_id)),
            )
            team_rows = await cur.fetchall()
            cur = await conn.execute(
                "select count(*), round(avg(rating)::numeric, 2) from job_reviews"
                " where fulfillment_technician_ref = %s and fulfillment_org_id = %s",
                (str(technician_id), str(organization_id)),
            )
            company = await cur.fetchone()
            cur = await conn.execute(
                "select count(*), round(avg(rating)::numeric, 2) from job_reviews"
                " where fulfillment_technician_ref = %s",
                (str(technician_id),),
            )
            global_row = await cur.fetchone()
        docs = await self.list_technician_documents(technician_id)
        photo_approved = row[4] == "approved"
        return {
            "id": str(technician_id),
            "display_name": row[0],
            "email": row[1],
            "phone": row[2],
            "profile_photo_url": row[3] if photo_approved else None,
            "profile_photo_status": row[4],
            "status": row[5],
            "vetting_status": row[6],
            "skills": list(row[7] or []),
            "rating": float(row[8]) if row[8] is not None else None,
            "location_updated_at": row[9].isoformat() if row[9] else None,
            "affiliation": {
                "status": row[10],
                "affiliation_type": row[11],
                "exclusivity": row[12],
                "dispatch_allowed": bool(row[13]),
                "affiliated_at": row[14].isoformat() if row[14] else None,
                "is_pending_invite": row[10] == "pending_invite",
            },
            "agreement": await self.get_provider_technician_agreement(organization_id, technician_id),
            "team_memberships": [
                {"team_id": str(tr[0]), "name": tr[1], "role": tr[2]} for tr in team_rows
            ],
            "reviews": {
                "company": {"count": int(company[0] or 0),
                            "average": float(company[1]) if company[1] is not None else None},
                "global": {"count": int(global_row[0] or 0),
                           "average": float(global_row[1]) if global_row[1] is not None else None},
            },
            "documents": docs,
        }

    @staticmethod
    def _agreement_row(row: tuple, organization_id: UUID, technician_id: UUID) -> dict:
        if row is None:
            return _default_agreement(str(organization_id), str(technician_id))
        return {
            "id": str(row[0]),
            "organization_id": str(row[1]),
            "technician_id": str(row[2]),
            "status": row[3],
            "effective_from": row[4].isoformat() if row[4] else None,
            "effective_until": row[5].isoformat() if row[5] else None,
            "default_labor_cut_basis_points": row[6],
            "tip_policy": row[7],
            "tip_cut_basis_points": row[8],
            "card_fee_policy": row[9],
            "minimum_payout_cents": row[10],
            "flat_job_bonus_cents": row[11],
            "service_area_counties": row[12] or [],
            "service_area_zipcodes": row[13] or [],
            "service_hours": row[14] or {},
            "rules": row[15] or {},
            "created_at": row[16].isoformat() if row[16] else None,
            "updated_at": row[17].isoformat() if row[17] else None,
            "updated_by": str(row[18]) if row[18] else None,
        }

    async def get_provider_technician_agreement(
        self, organization_id: UUID, technician_id: UUID
    ) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select 1 from organization_technicians"
                " where organization_id = %s and technician_id = %s and ended_at is null",
                (str(organization_id), str(technician_id)),
            )
            if await cur.fetchone() is None:
                return None
            cur = await conn.execute(
                "select id, organization_id, technician_id, status, effective_from, effective_until,"
                " default_labor_cut_basis_points, tip_policy, tip_cut_basis_points,"
                " card_fee_policy, minimum_payout_cents, flat_job_bonus_cents,"
                " service_area_counties, service_area_zipcodes, service_hours, rules,"
                " created_at, updated_at, updated_by"
                " from technician_agreements where organization_id = %s and technician_id = %s",
                (str(organization_id), str(technician_id)),
            )
            row = await cur.fetchone()
        return self._agreement_row(row, organization_id, technician_id)

    async def get_provider_technician_agreement_for_reporting(
        self, organization_id: UUID, technician_id: UUID
    ) -> tuple[dict | None, bool, str | None]:
        """Reporting variant: no open-affiliation gate, so historical rows for a
        tech who left keep their last-known terms instead of collapsing to zero.
        Returns (agreement | None, affiliation_ended, affiliation_ended_at)."""
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select count(*)::int, count(*) filter (where ended_at is null)::int, max(ended_at)"
                " from organization_technicians where organization_id = %s and technician_id = %s",
                (str(organization_id), str(technician_id)),
            )
            total_affs, open_affs, last_ended_at = await cur.fetchone()
            cur = await conn.execute(
                "select id, organization_id, technician_id, status, effective_from, effective_until,"
                " default_labor_cut_basis_points, tip_policy, tip_cut_basis_points,"
                " card_fee_policy, minimum_payout_cents, flat_job_bonus_cents,"
                " service_area_counties, service_area_zipcodes, service_hours, rules,"
                " created_at, updated_at, updated_by"
                " from technician_agreements where organization_id = %s and technician_id = %s",
                (str(organization_id), str(technician_id)),
            )
            row = await cur.fetchone()
        ended = total_affs > 0 and open_affs == 0
        ended_at = last_ended_at.isoformat() if ended and last_ended_at else None
        if row is None and total_affs == 0:
            return None, False, None
        return self._agreement_row(row, organization_id, technician_id), ended, ended_at

    async def upsert_provider_technician_agreement(
        self, organization_id: UUID, technician_id: UUID, data: dict, *, updated_by: str | None = None
    ) -> dict | None:
        from psycopg.types.json import Jsonb

        if await self.get_provider_technician_agreement(organization_id, technician_id) is None:
            return None
        async with await self._connect() as conn:
            cur = await conn.execute(
                "insert into technician_agreements"
                " (organization_id, technician_id, status, effective_from, effective_until,"
                "  default_labor_cut_basis_points, tip_policy, tip_cut_basis_points,"
                "  card_fee_policy, minimum_payout_cents, flat_job_bonus_cents,"
                "  service_area_counties, service_area_zipcodes, service_hours, rules, updated_by)"
                " values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
                " on conflict (organization_id, technician_id) do update set"
                "  status = excluded.status,"
                "  effective_from = excluded.effective_from,"
                "  effective_until = excluded.effective_until,"
                "  default_labor_cut_basis_points = excluded.default_labor_cut_basis_points,"
                "  tip_policy = excluded.tip_policy,"
                "  tip_cut_basis_points = excluded.tip_cut_basis_points,"
                "  card_fee_policy = excluded.card_fee_policy,"
                "  minimum_payout_cents = excluded.minimum_payout_cents,"
                "  flat_job_bonus_cents = excluded.flat_job_bonus_cents,"
                "  service_area_counties = excluded.service_area_counties,"
                "  service_area_zipcodes = excluded.service_area_zipcodes,"
                "  service_hours = excluded.service_hours,"
                "  rules = excluded.rules,"
                "  updated_by = excluded.updated_by,"
                "  updated_at = now()"
                " returning id, organization_id, technician_id, status, effective_from, effective_until,"
                " default_labor_cut_basis_points, tip_policy, tip_cut_basis_points,"
                " card_fee_policy, minimum_payout_cents, flat_job_bonus_cents,"
                " service_area_counties, service_area_zipcodes, service_hours, rules,"
                " created_at, updated_at, updated_by",
                (
                    str(organization_id),
                    str(technician_id),
                    data["status"],
                    data.get("effective_from"),
                    data.get("effective_until"),
                    data["default_labor_cut_basis_points"],
                    data["tip_policy"],
                    data["tip_cut_basis_points"],
                    data["card_fee_policy"],
                    data["minimum_payout_cents"],
                    data["flat_job_bonus_cents"],
                    Jsonb(data.get("service_area_counties") or []),
                    Jsonb(data.get("service_area_zipcodes") or []),
                    Jsonb(data.get("service_hours") or {}),
                    Jsonb(data.get("rules") or {}),
                    str(updated_by) if updated_by else None,
                ),
            )
            row = await cur.fetchone()
        return self._agreement_row(row, organization_id, technician_id)

    async def create_affiliated_technician(self, organization_id: UUID, data: dict) -> dict:
        email = (data.get("email") or "").strip() or None
        phone = (data.get("phone") or "").strip() or None
        try:
            async with await self._connect() as conn:
                # Existing global technician (by email or phone) → attach as a PENDING
                # INVITE, never a duplicate profile or a silent activation. Consent is
                # required to activate (technician-side acceptance flow is follow-up).
                existing_tid = None
                if email:
                    cur = await conn.execute(
                        "select t.id from technicians t join users u on u.id = t.id"
                        " where lower(u.email) = lower(%s)", (email,))
                    r = await cur.fetchone()
                    existing_tid = r[0] if r else None
                if existing_tid is None and phone:
                    cur = await conn.execute("select id from technicians where phone = %s", (phone,))
                    r = await cur.fetchone()
                    existing_tid = r[0] if r else None
                if existing_tid is not None:
                    await conn.execute(
                        "insert into organization_technicians"
                        " (organization_id, technician_id, role, status,"
                        "  affiliation_type, exclusivity, dispatch_allowed, starts_at)"
                        " values (%s, %s, 'affiliate_technician', 'pending_invite', %s, %s, %s, now())"
                        " on conflict (organization_id, technician_id) where ended_at is null"
                        " do update set status = 'pending_invite', updated_at = now()",
                        (str(organization_id), existing_tid,
                         data.get("affiliation_type") or "unknown",
                         data.get("exclusivity") or "unknown",
                         bool(data.get("dispatch_allowed", True))))
                    await conn.execute(
                        "insert into user_organization_memberships (user_id, organization_id, role, status)"
                        " values (%s, %s, 'technician', 'pending') on conflict (user_id, organization_id) do nothing",
                        (existing_tid, str(organization_id)))
                    return {
                        "id": str(existing_tid), "display_name": data.get("display_name"),
                        "email": email, "phone": phone, "existing": True, "global_status": "existing",
                        "affiliation": {
                            "status": "pending_invite",
                            "affiliation_type": data.get("affiliation_type") or "unknown",
                            "exclusivity": data.get("exclusivity") or "unknown",
                            "dispatch_allowed": bool(data.get("dispatch_allowed", True)),
                            "is_pending_invite": True,
                        },
                        "team_ids": data.get("team_ids") or [],
                    }
                # Email belongs to a non-technician user → cannot create or attach.
                if email:
                    cur = await conn.execute("select 1 from users where lower(email) = lower(%s)", (email,))
                    if await cur.fetchone():
                        raise ValueError("email_taken")
                password_hash = hash_password(data["password"])
                cur = await conn.execute(
                    "insert into users (email, phone, password_hash, display_name, status, locale)"
                    " values (%s, %s, %s, %s, 'active', %s) returning id",
                    (email, phone, password_hash, data["display_name"], data.get("locale")),
                )
                technician_id = (await cur.fetchone())[0]
                await conn.execute(
                    "insert into user_roles (user_id, role) values (%s, 'technician') on conflict do nothing",
                    (technician_id,),
                )
                await conn.execute(
                    "insert into technicians"
                    " (id, display_name, email, phone, status, vetting_status, skills,"
                    " service_area_center_lat, service_area_center_lng, service_area_radius_km,"
                    " is_available, provider_type, primary_organization_id)"
                    " values (%s, %s, %s, %s, 'pending_vetting', 'unverified', %s, %s, %s, %s,"
                    " false, 'affiliate', %s)",
                    (
                        technician_id, data["display_name"], email, phone, data.get("skills") or [],
                        data.get("service_area_center_lat"), data.get("service_area_center_lng"),
                        data.get("service_area_radius_km"), str(organization_id),
                    ),
                )
                await conn.execute(
                    "insert into organization_technicians"
                    " (organization_id, technician_id, role, status, activated_at,"
                    "  affiliation_type, exclusivity, dispatch_allowed, starts_at)"
                    " values (%s, %s, 'affiliate_technician', 'active', now(), %s, %s, %s, now())",
                    (
                        str(organization_id), technician_id,
                        data.get("affiliation_type") or "unknown",
                        data.get("exclusivity") or "unknown",
                        bool(data.get("dispatch_allowed", True)),
                    ),
                )
                await conn.execute(
                    "insert into user_organization_memberships"
                    " (user_id, organization_id, role, status)"
                    " values (%s, %s, 'technician', 'active')"
                    " on conflict (user_id, organization_id) do nothing",
                    (technician_id, str(organization_id)),
                )
                for team_id in data.get("team_ids") or []:
                    cur = await conn.execute(
                        "select 1 from organization_teams where id = %s and organization_id = %s",
                        (team_id, str(organization_id)),
                    )
                    if await cur.fetchone():
                        await conn.execute(
                            "insert into organization_team_technicians (team_id, technician_id)"
                            " values (%s, %s) on conflict do nothing",
                            (team_id, technician_id),
                        )
        except Exception as exc:
            if "uq_org_tech_active_exclusive" in str(exc):
                raise ValueError("exclusive_conflict") from exc
            raise
        return {
            "id": str(technician_id), "display_name": data["display_name"],
            "email": email, "phone": phone, "status": "pending_vetting",
            "global_status": "pending_vetting",
            "vetting_status": "unverified", "provider_type": "affiliate",
            "affiliation": {
                "status": "active",
                "affiliation_type": data.get("affiliation_type") or "unknown",
                "exclusivity": data.get("exclusivity") or "unknown",
                "dispatch_allowed": bool(data.get("dispatch_allowed", True)),
                "is_pending_invite": False,
            },
            "team_ids": data.get("team_ids") or [],
        }

    async def create_provider_document(self, organization_id: UUID, data: dict) -> dict:
        owner_type = data["owner_type"]
        owner_id = str(data.get("owner_id") or organization_id)
        async with await self._connect() as conn:
            if owner_type == "organization" and owner_id != str(organization_id):
                raise ValueError("invalid_document_owner")
            if owner_type == "technician":
                cur = await conn.execute(
                    "select 1 from organization_technicians"
                    " where organization_id = %s and technician_id = %s",
                    (str(organization_id), owner_id),
                )
                if not await cur.fetchone():
                    raise ValueError("invalid_document_owner")
            cur = await conn.execute(
                "insert into provider_documents"
                " (owner_type, owner_id, document_type, document_number, issuing_authority,"
                " jurisdiction, issued_at, expires_at, storage_bucket, storage_path, notes)"
                " values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
                " returning id, status, submitted_at",
                (
                    owner_type, owner_id, data["document_type"], data.get("document_number"),
                    data.get("issuing_authority"), data.get("jurisdiction"), data.get("issued_at"),
                    data.get("expires_at"), data.get("storage_bucket") or "private-verification",
                    data.get("storage_path"), data.get("notes"),
                ),
            )
            row = await cur.fetchone()
        return {
            "id": str(row[0]), "owner_type": owner_type, "owner_id": owner_id,
            "document_type": data["document_type"], "status": row[1],
            "storage_bucket": data.get("storage_bucket") or "private-verification",
            "storage_path": data.get("storage_path"),
            "submitted_at": row[2].isoformat() if row[2] else None,
        }

    async def review_provider_document(
        self, document_id: UUID, *, status: str, reviewer_id: UUID | None
    ) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "update provider_documents set status = %s,"
                " verified_at = case when %s = 'verified' then now() else null end,"
                " verified_by = %s, updated_at = now() where id = %s"
                " returning id, owner_type, owner_id, document_type, status, verified_at",
                (status, status, str(reviewer_id) if reviewer_id else None, str(document_id)),
            )
            row = await cur.fetchone()
        if not row:
            return None
        return {
            "id": str(row[0]), "owner_type": row[1], "owner_id": str(row[2]),
            "document_type": row[3], "status": row[4],
            "verified_at": row[5].isoformat() if row[5] else None,
        }

    async def update_technician_location(
        self, technician_id: UUID, *, lat: float, lng: float
    ) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "update technicians set current_lat = %s, current_lng = %s,"
                " location_updated_at = now()"
                " where id = %s returning id, current_lat, current_lng, location_updated_at",
                (lat, lng, str(technician_id)),
            )
            row = await cur.fetchone()
        if not row:
            return None
        return {
            "id": str(row[0]), "current_lat": row[1], "current_lng": row[2],
            "last_location_at": row[3].isoformat() if row[3] else None,
        }

    async def update_technician_availability(
        self, technician_id: UUID, *, is_available: bool
    ) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "update technicians set is_available = %s"
                " where id = %s and status = 'active' and vetting_status = 'verified'"
                " returning id, is_available",
                (is_available, str(technician_id)),
            )
            row = await cur.fetchone()
        return {"id": str(row[0]), "is_available": row[1]} if row else None

    async def list_technician_offers(self, technician_id: UUID) -> list[dict]:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select o.id, o.job_id, o.status, o.rank, o.offered_at, o.expires_at,"
                " j.access_type, j.lat, j.lng"
                " from dispatch_offers o join jobs j on j.id = o.job_id"
                " where o.technician_id = %s and o.status = 'offered'"
                " and (o.expires_at is null or o.expires_at > now())"
                " order by o.offered_at desc",
                (str(technician_id),),
            )
            rows = await cur.fetchall()
        # Masked: coarse area only (~1km) — no exact address / customer before acceptance.
        return [
            {
                "id": str(r[0]),
                "job_id": str(r[1]),
                "status": r[2],
                "rank": r[3],
                "offered_at": r[4].isoformat() if r[4] else None,
                "expires_at": r[5].isoformat() if r[5] else None,
                "access_type": r[6],
                "area_lat": round(r[7], 2) if r[7] is not None else None,
                "area_lng": round(r[8], 2) if r[8] is not None else None,
            }
            for r in rows
        ]

    async def list_technician_documents(self, technician_id: UUID) -> list[dict]:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select id, document_type, document_number, storage_bucket,"
                " storage_path, status, rejected_reason, expiration_date,"
                " uploaded_at, reviewed_at"
                " from technician_documents"
                " where technician_id = %s"
                " order by uploaded_at desc",
                (str(technician_id),),
            )
            rows = await cur.fetchall()
        return [
            {
                "id": str(r[0]),
                "document_type": r[1],
                "document_number": r[2],
                "storage_bucket": r[3],
                "storage_path": r[4],
                "status": r[5],
                "rejected_reason": r[6],
                "expiration_date": r[7].isoformat() if r[7] else None,
                "uploaded_at": r[8].isoformat() if r[8] else None,
                "reviewed_at": r[9].isoformat() if r[9] else None,
            }
            for r in rows
        ]

    async def create_technician_document(
        self, technician_id: UUID, data: dict
    ) -> dict:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "insert into technician_documents"
                " (technician_id, document_type, document_number, storage_bucket,"
                " storage_path, status, rejected_reason, expiration_date)"
                " values (%s, %s, %s, %s, %s, %s, %s, %s)"
                " returning id, uploaded_at, reviewed_at",
                (
                    str(technician_id),
                    data["document_type"],
                    data.get("document_number"),
                    data.get("storage_bucket", "private-technician-docs"),
                    data.get("storage_path"),
                    "pending_review",
                    None,
                    data.get("expiration_date"),
                ),
            )
            row = await cur.fetchone()
        return {
            "id": str(row[0]),
            "technician_id": str(technician_id),
            "document_type": data["document_type"],
            "document_number": data.get("document_number"),
            "storage_bucket": data.get("storage_bucket", "private-technician-docs"),
            "storage_path": data.get("storage_path"),
            "status": "pending_review",
            "rejected_reason": None,
            "expiration_date": data.get("expiration_date"),
            "uploaded_at": row[1].isoformat() if row[1] else None,
            "reviewed_at": row[2].isoformat() if row[2] else None,
        }

    async def review_technician_document(
        self, document_id: UUID, *, status: str, reviewer_id: UUID | None, reason: str | None = None
    ) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "update technician_documents set status = %s,"
                " rejected_reason = %s, reviewed_at = now()"
                " where id = %s returning id, technician_id, document_type,"
                " document_number, storage_bucket, storage_path, expiration_date,"
                " uploaded_at, reviewed_at",
                (status, reason, str(document_id)),
            )
            row = await cur.fetchone()
        if not row:
            return None
        return {
            "id": str(row[0]),
            "technician_id": str(row[1]),
            "document_type": row[2],
            "document_number": row[3],
            "storage_bucket": row[4],
            "storage_path": row[5],
            "status": status,
            "rejected_reason": reason,
            "expiration_date": row[6].isoformat() if row[6] else None,
            "uploaded_at": row[7].isoformat() if row[7] else None,
            "reviewed_at": row[8].isoformat() if row[8] else None,
        }

    async def get_technician_document(self, document_id: UUID, technician_id: UUID) -> dict | None:
        """Fetch one of the technician's own documents (self-scoped: technician_id must
        match). Returns bucket/path for issuing a signed download URL."""
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select id, technician_id, document_type, storage_bucket, storage_path, status"
                " from technician_documents where id = %s and technician_id = %s",
                (str(document_id), str(technician_id)),
            )
            row = await cur.fetchone()
        if not row:
            return None
        return {
            "id": str(row[0]), "technician_id": str(row[1]), "document_type": row[2],
            "storage_bucket": row[3], "storage_path": row[4], "status": row[5],
        }

    async def list_pending_technician_documents(self) -> list[dict]:
        """All technician documents awaiting Ops review (with technician name)."""
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select d.id, d.technician_id, t.display_name, d.document_type,"
                " d.document_number, d.status, d.expiration_date, d.uploaded_at"
                " from technician_documents d"
                " join technicians t on t.id = d.technician_id"
                " where d.status = 'pending_review' order by d.uploaded_at",
            )
            rows = await cur.fetchall()
        return [
            {
                "id": str(r[0]), "technician_id": str(r[1]), "technician_name": r[2],
                "document_type": r[3], "document_number": r[4], "status": r[5],
                "expiration_date": r[6].isoformat() if r[6] else None,
                "uploaded_at": r[7].isoformat() if r[7] else None,
            }
            for r in rows
        ]

    async def get_technician_document_admin(self, document_id: UUID) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select storage_bucket, storage_path from technician_documents where id = %s",
                (str(document_id),),
            )
            row = await cur.fetchone()
        if row is None:
            return None
        return {"storage_bucket": row[0], "storage_path": row[1]}

    # --- global_settings ---
    @staticmethod
    def _global_setting_row(row: tuple) -> dict:
        return {
            "key": row[0],
            "value": row[1],  # jsonb → already a native Python value (int/str/bool/...)
            "value_type": row[2],
            "description": row[3],
            "is_secret": row[4],
            "is_runtime_editable": row[5],
            "updated_at": row[6].isoformat() if row[6] else None,
            "updated_by": str(row[7]) if row[7] else None,
        }

    _GLOBAL_SETTING_COLS = (
        "key, value, value_type, description, is_secret, is_runtime_editable,"
        " updated_at, updated_by"
    )

    async def get_global_setting(self, key: str) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                f"select {self._GLOBAL_SETTING_COLS} from global_settings where key = %s",
                (key,),
            )
            row = await cur.fetchone()
        return self._global_setting_row(row) if row is not None else None

    async def list_global_settings(self) -> list[dict]:
        async with await self._connect() as conn:
            cur = await conn.execute(
                f"select {self._GLOBAL_SETTING_COLS} from global_settings order by key"
            )
            rows = await cur.fetchall()
        return [self._global_setting_row(r) for r in rows]

    async def upsert_global_setting(
        self, key: str, value: object, value_type: str, updated_by: str | None = None
    ) -> dict:
        from psycopg.types.json import Jsonb

        async with await self._connect() as conn:
            cur = await conn.execute(
                "insert into global_settings (key, value, value_type, updated_by, updated_at)"
                " values (%s, %s, %s, %s, now())"
                " on conflict (key) do update set"
                "   value = excluded.value,"
                "   value_type = excluded.value_type,"
                "   updated_by = excluded.updated_by,"
                "   updated_at = now()"
                f" returning {self._GLOBAL_SETTING_COLS}",
                (key, Jsonb(value), value_type, str(updated_by) if updated_by else None),
            )
            row = await cur.fetchone()
        return self._global_setting_row(row)

    @staticmethod
    def _service_category_row(row: tuple) -> dict:
        return {
            "code": row[0],
            "label": row[1],
            "status": row[2],
            "sort_order": row[3],
            "updated_at": row[4].isoformat() if row[4] else None,
            "updated_by": str(row[5]) if row[5] else None,
            "skills": [],
        }

    @staticmethod
    def _service_skill_row(row: tuple) -> dict:
        return {
            "code": row[0],
            "category_code": row[1],
            "label": row[2],
            "status": row[3],
            "requires_verification": row[4],
            "sort_order": row[5],
            "updated_at": row[6].isoformat() if row[6] else None,
            "updated_by": str(row[7]) if row[7] else None,
        }

    async def list_service_catalog(self, active_only: bool = False) -> list[dict]:
        category_where = " where status = 'active'" if active_only else ""
        skill_where = " where status = 'active'" if active_only else ""
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select code, label, status, sort_order, updated_at, updated_by"
                f" from service_categories{category_where}"
                " order by sort_order, code"
            )
            category_rows = await cur.fetchall()
            cur = await conn.execute(
                "select code, category_code, label, status, requires_verification,"
                " sort_order, updated_at, updated_by"
                f" from service_skills{skill_where}"
                " order by sort_order, code"
            )
            skill_rows = await cur.fetchall()
        categories = {row[0]: self._service_category_row(row) for row in category_rows}
        for row in skill_rows:
            skill = self._service_skill_row(row)
            category = categories.get(skill["category_code"])
            if category is not None:
                category["skills"].append(skill)
        return list(categories.values())

    async def upsert_service_category(self, data: dict, updated_by: str | None = None) -> dict:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "insert into service_categories (code, label, status, sort_order, updated_by, updated_at)"
                " values (%s, %s, %s, %s, %s, now())"
                " on conflict (code) do update set"
                "   label = excluded.label,"
                "   status = excluded.status,"
                "   sort_order = excluded.sort_order,"
                "   updated_by = excluded.updated_by,"
                "   updated_at = now()"
                " returning code, label, status, sort_order, updated_at, updated_by",
                (
                    data["code"],
                    data["label"],
                    data["status"],
                    data["sort_order"],
                    str(updated_by) if updated_by else None,
                ),
            )
            row = await cur.fetchone()
        return self._service_category_row(row)

    async def upsert_service_skill(self, data: dict, updated_by: str | None = None) -> dict:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select 1 from service_categories where code = %s",
                (data["category_code"],),
            )
            if await cur.fetchone() is None:
                raise KeyError(data["category_code"])
            cur = await conn.execute(
                "insert into service_skills"
                " (code, category_code, label, status, requires_verification, sort_order, updated_by, updated_at)"
                " values (%s, %s, %s, %s, %s, %s, %s, now())"
                " on conflict (code) do update set"
                "   category_code = excluded.category_code,"
                "   label = excluded.label,"
                "   status = excluded.status,"
                "   requires_verification = excluded.requires_verification,"
                "   sort_order = excluded.sort_order,"
                "   updated_by = excluded.updated_by,"
                "   updated_at = now()"
                " returning code, category_code, label, status, requires_verification,"
                " sort_order, updated_at, updated_by",
                (
                    data["code"],
                    data["category_code"],
                    data["label"],
                    data["status"],
                    data["requires_verification"],
                    data["sort_order"],
                    str(updated_by) if updated_by else None,
                ),
            )
            row = await cur.fetchone()
        return self._service_skill_row(row)

    @staticmethod
    def _closeout_item_type_row(row: tuple) -> dict:
        return {
            "code": row[0],
            "label": row[1],
            "status": row[2],
            "default_taxable": row[3],
            "default_compensation_eligible": row[4],
            "default_reimbursement_eligible": row[5],
            "requires_provided_by": row[6],
            "requires_note": row[7],
            "requires_receipt": row[8],
            "sort_order": row[9],
            "updated_at": row[10].isoformat() if row[10] else None,
            "updated_by": str(row[11]) if row[11] else None,
        }

    _CLOSEOUT_ITEM_TYPE_COLS = (
        "code, label, status, default_taxable, default_compensation_eligible,"
        " default_reimbursement_eligible, requires_provided_by, requires_note,"
        " requires_receipt, sort_order, updated_at, updated_by"
    )

    async def list_closeout_item_types(self, active_only: bool = False) -> list[dict]:
        where = " where status = 'active'" if active_only else ""
        async with await self._connect() as conn:
            cur = await conn.execute(
                f"select {self._CLOSEOUT_ITEM_TYPE_COLS} from closeout_item_types{where}"
                " order by sort_order, code"
            )
            rows = await cur.fetchall()
        return [self._closeout_item_type_row(r) for r in rows]

    async def upsert_closeout_item_type(self, data: dict, updated_by: str | None = None) -> dict:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "insert into closeout_item_types"
                " (code, label, status, default_taxable, default_compensation_eligible,"
                "  default_reimbursement_eligible, requires_provided_by, requires_note,"
                "  requires_receipt, sort_order, updated_by, updated_at)"
                " values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())"
                " on conflict (code) do update set"
                "   label = excluded.label,"
                "   status = excluded.status,"
                "   default_taxable = excluded.default_taxable,"
                "   default_compensation_eligible = excluded.default_compensation_eligible,"
                "   default_reimbursement_eligible = excluded.default_reimbursement_eligible,"
                "   requires_provided_by = excluded.requires_provided_by,"
                "   requires_note = excluded.requires_note,"
                "   requires_receipt = excluded.requires_receipt,"
                "   sort_order = excluded.sort_order,"
                "   updated_by = excluded.updated_by,"
                "   updated_at = now()"
                f" returning {self._CLOSEOUT_ITEM_TYPE_COLS}",
                (
                    data["code"],
                    data["label"],
                    data["status"],
                    data["default_taxable"],
                    data["default_compensation_eligible"],
                    data["default_reimbursement_eligible"],
                    data["requires_provided_by"],
                    data["requires_note"],
                    data["requires_receipt"],
                    data["sort_order"],
                    str(updated_by) if updated_by else None,
                ),
            )
            row = await cur.fetchone()
        return self._closeout_item_type_row(row)

    async def list_organization_capabilities(self, organization_id: str) -> list[str]:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select skill_code from organization_capabilities"
                " where organization_id = %s and status = 'active'"
                " order by skill_code",
                (str(organization_id),),
            )
            rows = await cur.fetchall()
        return [r[0] for r in rows]

    async def replace_organization_capabilities(
        self, organization_id: str, skill_codes: list[str], updated_by: str | None = None
    ) -> list[str]:
        async with await self._connect() as conn:
            await conn.execute(
                "update organization_capabilities set status = 'inactive',"
                " updated_by = %s, updated_at = now()"
                " where organization_id = %s",
                (str(updated_by) if updated_by else None, str(organization_id)),
            )
            for skill_code in skill_codes:
                await conn.execute(
                    "insert into organization_capabilities"
                    " (organization_id, skill_code, status, updated_by, updated_at)"
                    " values (%s, %s, 'active', %s, now())"
                    " on conflict (organization_id, skill_code) do update set"
                    "   status = 'active',"
                    "   updated_by = excluded.updated_by,"
                    "   updated_at = now()",
                    (str(organization_id), skill_code, str(updated_by) if updated_by else None),
                )
        return await self.list_organization_capabilities(organization_id)

    async def get_organization_setting(self, organization_id: str, key: str) -> dict | None:
        async with await self._connect() as conn:
            cur = await conn.execute(
                "select organization_id, key, value, value_type, updated_at, updated_by"
                " from organization_settings where organization_id = %s and key = %s",
                (str(organization_id), key),
            )
            row = await cur.fetchone()
        if row is None:
            return None
        return {
            "organization_id": str(row[0]),
            "key": row[1],
            "value": row[2],
            "value_type": row[3],
            "updated_at": row[4].isoformat() if row[4] else None,
            "updated_by": str(row[5]) if row[5] else None,
        }

    async def upsert_organization_setting(
        self, organization_id: str, key: str, value: object, value_type: str, updated_by: str | None = None
    ) -> dict:
        from psycopg.types.json import Jsonb

        async with await self._connect() as conn:
            await conn.execute(
                "insert into organization_settings"
                " (organization_id, key, value, value_type, updated_by, updated_at)"
                " values (%s, %s, %s, %s, %s, now())"
                " on conflict (organization_id, key) do update set"
                "   value = excluded.value,"
                "   value_type = excluded.value_type,"
                "   updated_by = excluded.updated_by,"
                "   updated_at = now()",
                (str(organization_id), key, Jsonb(value), value_type, str(updated_by) if updated_by else None),
            )
        return await self.get_organization_setting(organization_id, key)  # type: ignore[return-value]

    async def delete_organization_setting(self, organization_id: str, key: str) -> None:
        async with await self._connect() as conn:
            await conn.execute(
                "delete from organization_settings where organization_id = %s and key = %s",
                (str(organization_id), key),
            )


def make_store() -> Store:
    if DATABASE_URL:
        return PostgresStore(DATABASE_URL)
    return InMemoryStore()
