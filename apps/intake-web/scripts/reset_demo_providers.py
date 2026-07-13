"""Repeatable demo seed/reset for provider companies.

Cleans the legacy **Metro Key** demo jobs (FK-safe) and (re)seeds the Tampa
provider **Florida Locksmith** with its technicians and a few clean demo jobs.
Idempotent — run it as often as you like; it upserts and never duplicates.

Usage (from apps/intake-web):

    DATABASE_URL=postgres://...  uv run python scripts/reset_demo_providers.py
    # or via the workspace script:
    npm run demo:reset --workspace @cluexp/intake-web

Connection: uses ``DATABASE_URL`` (runtime pooler) or ``MIGRATION_DATABASE_URL``
(direct host). The direct host is preferred for a batch reset; pass --db to override.

Flags:
    --no-clean   skip the Metro Key cleanup (only ensure Florida + reseed jobs)
    --no-jobs    skip seeding Florida demo jobs (only ensure company + roster + clean)
    --dry-run    run inside a transaction and roll back (preview counts, change nothing)
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from api import demo_seed  # noqa: E402
from api.auth import hash_password  # noqa: E402
from api.store import DEMO_PASSWORD  # noqa: E402


def _dsn(override: str | None) -> str:
    dsn = (
        override
        or os.environ.get("MIGRATION_DATABASE_URL")
        or os.environ.get("DATABASE_URL")
    )
    if not dsn:
        sys.exit(
            "No database URL. Set MIGRATION_DATABASE_URL or DATABASE_URL "
            "(or pass --db postgres://...)."
        )
    return dsn


async def _run(args: argparse.Namespace) -> dict:
    import psycopg

    password_hash = hash_password(DEMO_PASSWORD, salt="cluexp-demo-salt")
    autocommit = not args.dry_run
    async with await psycopg.AsyncConnection.connect(
        _dsn(args.db), autocommit=autocommit, prepare_threshold=None
    ) as conn:
        summary = await demo_seed.reset_demo(
            conn,
            password_hash=password_hash,
            clean_metro=not args.no_clean,
            seed_jobs=not args.no_jobs,
        )
        if args.dry_run:
            await conn.rollback()
            summary["dry_run"] = True
    return summary


def _print_report(summary: dict) -> None:
    fl = summary["florida"]
    metro = summary["metro"]
    jobs = summary["jobs"]
    val = summary["validation"]
    print("\n=== Demo reset summary ===")
    if summary.get("dry_run"):
        print("(DRY RUN — all changes rolled back)")
    print(f"Florida Locksmith provider ID : {fl['org_id']}")
    print(f"  intake channel ID           : {fl['channel_id']}")
    print(f"  technicians seeded          : {fl['technician_count']}")
    print(f"Florida demo jobs (active)    : {val['florida_demo_jobs']}"
          f" (created this run: {jobs.get('jobs_created', '-')})")
    if metro.get("metro_org_found"):
        print(f"Metro Key jobs cleaned        : {metro['jobs_cleaned']}")
        print(f"  offers/tracking cleaned     : {metro['offers_tracking_cleaned']}")
        print(f"  child rows cleaned          : {metro.get('child_rows_cleaned', 0)}")
        print(f"  orphan customers cleaned    : {metro['customers_cleaned']}")
    else:
        print("Metro Key provider            : not present (nothing to clean)"
              if not metro.get("skipped") else "Metro Key cleanup             : skipped")
    print(f"Validation                    : {'OK' if val['ok'] else 'ISSUES'}")
    for issue in val["issues"]:
        print(f"  ! {issue}")
    print("\nfull summary (json):")
    print(json.dumps(summary, indent=2, default=str))


def main() -> None:
    parser = argparse.ArgumentParser(description="Reset/seed demo provider data.")
    parser.add_argument("--db", help="database URL override")
    parser.add_argument("--no-clean", action="store_true", help="skip Metro Key cleanup")
    parser.add_argument("--no-jobs", action="store_true", help="skip seeding demo jobs")
    parser.add_argument("--dry-run", action="store_true", help="preview; roll back changes")
    args = parser.parse_args()

    # psycopg's async path needs a selector loop on Windows (the default Proactor
    # loop is unsupported); harmless elsewhere.
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

    summary = asyncio.run(_run(args))
    _print_report(summary)
    if not summary["validation"]["ok"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
